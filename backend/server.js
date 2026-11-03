import "dotenv/config";

import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { WebSocket, WebSocketServer } from "ws";
import {
    parseCookies,
    redactJson,
    redactText,
    safeEqual,
    signValue,
    validateJsonObject,
    verifyValue
} from "./lib/security.js";
import {
    validateCommand,
    validateCommandResult,
    validateHeartbeat
} from "./lib/protocol.js";

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function readOrigin(name, fallback) {
    const configuredValue = process.env[name]?.trim();
    if (isProduction && !configuredValue) throw new Error(`Missing required environment variable: ${name}`);
    const value = configuredValue || fallback;
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
        throw new Error(`${name} must be an HTTP(S) origin with no path, query, or fragment.`);
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error(`${name} must use HTTPS in production.`);
    }
    return url.origin;
}

const isProduction = process.env.NODE_ENV === "production";
const config = {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    publicOrigin: readOrigin("PUBLIC_ORIGIN", "http://localhost:8000"),
    apiPublicUrl: readOrigin("API_PUBLIC_URL", "http://localhost:3000"),
    discordClientId: required("DISCORD_CLIENT_ID"),
    discordClientSecret: required("DISCORD_CLIENT_SECRET"),
    ownerDiscordId: required("OWNER_DISCORD_ID"),
    sessionSecret: required("SESSION_SECRET"),
    botConnectionSecret: required("BOT_CONNECTION_SECRET"),
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    approvedGuildIds: new Set((process.env.APPROVED_GUILD_IDS ?? "")
        .split(",").map((id) => id.trim()).filter(Boolean)),
    allowedCommands: [...new Set((process.env.BOT_ALLOWED_COMMANDS ?? "")
        .split(",").map((command) => command.trim()).filter(Boolean))],
    botLogRetentionDays: Number.parseInt(process.env.BOT_LOG_RETENTION_DAYS ?? "30", 10),
    botCommandRetentionDays: Number.parseInt(process.env.BOT_COMMAND_RETENTION_DAYS ?? "90", 10),
    secureCookies: isProduction,
    sessionCookie: "piroma_bot_session",
    stateCookie: "piroma_oauth_state",
    heartbeatMaxAgeMs: 45000,
    websocketPath: "/bot/connect"
};

if (!/^\d{17,20}$/.test(config.ownerDiscordId)) throw new Error("OWNER_DISCORD_ID must be a Discord user ID.");
if (!/^\d{17,20}$/.test(config.discordClientId)) throw new Error("DISCORD_CLIENT_ID must be a Discord application ID.");
if (config.sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
if (config.botConnectionSecret.length < 32) throw new Error("BOT_CONNECTION_SECRET must contain at least 32 characters.");
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("PORT must be a valid TCP port.");
for (const [name, days] of [
    ["BOT_LOG_RETENTION_DAYS", config.botLogRetentionDays],
    ["BOT_COMMAND_RETENTION_DAYS", config.botCommandRetentionDays]
]) {
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error(`${name} must be between 1 and 3650 days.`);
}
if (!/^https?:\/\//.test(config.supabaseUrl)) throw new Error("SUPABASE_URL must be an HTTP(S) URL.");
for (const guildId of config.approvedGuildIds) {
    if (!/^\d{17,20}$/.test(guildId)) throw new Error("APPROVED_GUILD_IDS must contain only Discord server IDs.");
}
if (config.approvedGuildIds.size > 500) throw new Error("APPROVED_GUILD_IDS may contain at most 500 server IDs.");
for (const command of config.allowedCommands) {
    if (!/^[a-z][a-z0-9:_-]{0,63}$/.test(command)) throw new Error(`Invalid BOT_ALLOWED_COMMANDS entry: ${command}`);
}

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});
const app = express();
const server = createServer(app);
const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    perMessageDeflate: false
});
const pendingCommands = new Map();
let activeBot = null;
let lastHeartbeatAt = 0;
let currentBotStartedAt = null;

app.disable("x-powered-by");
app.set("trust proxy", isProduction ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin === config.publicOrigin) {
        response.setHeader("Access-Control-Allow-Origin", config.publicOrigin);
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
        if (origin !== config.publicOrigin) return response.sendStatus(403);
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
        return response.sendStatus(204);
    }
    next();
});
app.use(express.json({ limit: "16kb", strict: true }));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false
});
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false
});
app.use("/auth", authLimiter);
app.use("/api", apiLimiter);

function cookieAttributes({ maxAge, path = "/", httpOnly = true } = {}) {
    return [
        `Path=${path}`,
        "SameSite=Lax",
        ...(httpOnly ? ["HttpOnly"] : []),
        ...(config.secureCookies ? ["Secure"] : []),
        ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`])
    ].join("; ");
}

function setCookie(response, name, value, options = {}) {
    response.append("Set-Cookie", `${name}=${value}; ${cookieAttributes(options)}`);
}

function clearCookie(response, name, path = "/") {
    setCookie(response, name, "", { path, maxAge: 0 });
}

function getSession(request) {
    const cookie = parseCookies(request.headers.cookie).get(config.sessionCookie);
    const session = verifyValue(cookie, config.sessionSecret);
    if (!session || session.userId !== config.ownerDiscordId || typeof session.csrf !== "string") return null;
    return session;
}

function requireOwner(request, response, next) {
    const session = getSession(request);
    if (!session) return response.status(401).json({ error: "Sign in with the configured owner Discord account." });
    request.ownerSession = session;
    next();
}

function requireCsrf(request, response, next) {
    const origin = request.get("origin");
    const csrf = request.get("x-csrf-token");
    if (origin !== config.publicOrigin || !safeEqual(csrf, request.ownerSession.csrf)) {
        return response.status(403).json({ error: "Request verification failed." });
    }
    next();
}

function asyncRoute(handler) {
    return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function publicStatusPayload(status, guildRows) {
    const now = Date.now();
    const lastHeartbeat = status?.last_heartbeat ? Date.parse(status.last_heartbeat) : 0;
    const online = Boolean(status?.online) && Number.isFinite(lastHeartbeat) &&
        now - lastHeartbeat <= config.heartbeatMaxAgeMs;
    const guilds = guildRows.map((guild) => ({
        name: guild.guild_name,
        memberCount: guild.member_count
    }));
    return {
        status: online ? "online" : "offline",
        uptimeSeconds: online && status?.started_at
            ? Math.max(0, Math.floor((now - Date.parse(status.started_at)) / 1000))
            : null,
        lastSeen: lastHeartbeat ? new Date(lastHeartbeat).toISOString() : null,
        approvedServers: guilds,
        approvedServerCount: guilds.length,
        approvedMemberCount: guilds.reduce((total, guild) => total + guild.memberCount, 0)
    };
}

function throwDatabaseError(error, operation) {
    if (!error) return;
    const wrapped = new Error(`Supabase operation failed: ${operation}`);
    wrapped.cause = error;
    throw wrapped;
}

async function addLog(level, message) {
    const { error } = await supabase.from("bot_dashboard_logs").insert({
        level,
        message: redactText(message)
    });
    throwDatabaseError(error, "write bot log");
}

async function getBotSettings() {
    const { data, error } = await supabase
        .from("bot_dashboard_settings")
        .select("settings")
        .eq("id", "primary")
        .maybeSingle();
    throwDatabaseError(error, "read bot settings");
    return data?.settings ?? {};
}

function sendBotMessage(message) {
    if (!activeBot || activeBot.readyState !== WebSocket.OPEN) return false;
    activeBot.send(JSON.stringify(message));
    return true;
}

function rejectPendingCommands(reason) {
    for (const [id, pending] of pendingCommands) {
        clearTimeout(pending.timeout);
        pendingCommands.delete(id);
        void supabase.from("bot_dashboard_commands")
            .update({ status: "failed", result: { error: reason }, completed_at: new Date().toISOString() })
            .eq("id", id)
            .then(({ error }) => {
                if (error) console.error("Could not mark interrupted bot command as failed:", error.message);
            });
        pending.reject(Object.assign(new Error(reason), { status: 503 }));
    }
}

app.get("/healthz", (_request, response) => response.json({ status: "ok" }));

app.get("/auth/discord", (request, response) => {
    const state = randomBytes(32).toString("base64url");
    const signedState = signValue({ state, exp: Math.floor(Date.now() / 1000) + 600 }, config.sessionSecret);
    setCookie(response, config.stateCookie, signedState, { path: "/auth/discord/callback", maxAge: 600 });
    const authorize = new URL("https://discord.com/oauth2/authorize");
    authorize.searchParams.set("client_id", config.discordClientId);
    authorize.searchParams.set("redirect_uri", `${config.apiPublicUrl}/auth/discord/callback`);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "identify");
    authorize.searchParams.set("state", state);
    response.redirect(302, authorize.toString());
});

app.get("/auth/discord/callback", asyncRoute(async (request, response) => {
    const cookies = parseCookies(request.headers.cookie);
    const signedState = verifyValue(cookies.get(config.stateCookie), config.sessionSecret);
    clearCookie(response, config.stateCookie, "/auth/discord/callback");
    const state = typeof request.query.state === "string" ? request.query.state : "";
    if (!signedState?.state || !safeEqual(signedState.state, state)) {
        return response.status(400).send("Discord sign-in could not be verified. Return to the bot dashboard and try again.");
    }
    if (typeof request.query.error === "string" || typeof request.query.code !== "string") {
        return response.redirect(303, `${config.publicOrigin}/bot-admin.html?login=cancelled`);
    }

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.discordClientId,
            client_secret: config.discordClientSecret,
            grant_type: "authorization_code",
            code: request.query.code,
            redirect_uri: `${config.apiPublicUrl}/auth/discord/callback`
        }),
        signal: AbortSignal.timeout(10000)
    });
    if (!tokenResponse.ok) {
        console.error("Discord OAuth code exchange failed:", tokenResponse.status);
        return response.redirect(303, `${config.publicOrigin}/bot-admin.html?login=failed`);
    }
    const tokenData = await tokenResponse.json();
    if (typeof tokenData.access_token !== "string") {
        console.error("Discord OAuth response did not contain an access token.");
        return response.redirect(303, `${config.publicOrigin}/bot-admin.html?login=failed`);
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10000)
    });
    if (!userResponse.ok) {
        console.error("Discord identity lookup failed:", userResponse.status);
        return response.redirect(303, `${config.publicOrigin}/bot-admin.html?login=failed`);
    }
    const user = await userResponse.json();
    if (typeof user.id !== "string" || !safeEqual(user.id, config.ownerDiscordId)) {
        clearCookie(response, config.sessionCookie);
        return response.redirect(303, `${config.publicOrigin}/bot-admin.html?login=denied`);
    }

    const session = {
        userId: user.id,
        username: typeof user.username === "string" ? user.username.slice(0, 100) : "Discord owner",
        csrf: randomBytes(32).toString("base64url"),
        exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
    };
    setCookie(response, config.sessionCookie, signValue(session, config.sessionSecret), {
        path: "/",
        maxAge: 8 * 60 * 60
    });
    response.redirect(303, `${config.publicOrigin}/bot-admin.html`);
}));

app.get("/auth/logout", (_request, response) => response.status(405).json({ error: "Use POST to sign out." }));
app.post("/auth/logout", requireOwner, requireCsrf, (_request, response) => {
    clearCookie(response, config.sessionCookie);
    response.status(204).end();
});

app.get("/api/public/status", asyncRoute(async (_request, response) => {
    const { data: status, error: statusError } = await supabase
        .from("bot_dashboard_status")
        .select("online, started_at, last_heartbeat")
        .eq("id", "primary")
        .maybeSingle();
    throwDatabaseError(statusError, "read public bot status");

    let guildRows = [];
    if (config.approvedGuildIds.size) {
        const { data, error } = await supabase
            .from("bot_dashboard_guilds")
            .select("guild_name, member_count")
            .in("guild_id", [...config.approvedGuildIds])
            .order("guild_name", { ascending: true });
        throwDatabaseError(error, "read approved server member counts");
        guildRows = data ?? [];
    }
    const connected = activeBot?.readyState === WebSocket.OPEN &&
        Date.now() - lastHeartbeatAt <= config.heartbeatMaxAgeMs;
    response.setHeader("Cache-Control", "no-store");
    response.json(publicStatusPayload({
        ...status,
        online: connected,
        started_at: connected ? currentBotStartedAt : status?.started_at,
        last_heartbeat: connected ? new Date(lastHeartbeatAt).toISOString() : status?.last_heartbeat
    }, guildRows));
}));

app.get("/api/session", (request, response) => {
    const session = getSession(request);
    response.setHeader("Cache-Control", "no-store");
    if (!session) return response.json({ authenticated: false });
    response.json({
        authenticated: true,
        user: { id: session.userId, username: session.username },
        csrfToken: session.csrf,
        expiresAt: session.exp * 1000
    });
});

app.get("/api/admin", requireOwner, asyncRoute(async (_request, response) => {
    const settings = await getBotSettings();
    response.setHeader("Cache-Control", "no-store");
    response.json({ settings, allowedCommands: config.allowedCommands });
}));

app.put("/api/admin/settings", requireOwner, requireCsrf, asyncRoute(async (request, response) => {
    const settings = request.body?.settings;
    const validationError = validateJsonObject(settings, 8192);
    if (validationError) return response.status(400).json({ error: validationError });

    const { error } = await supabase.from("bot_dashboard_settings").upsert({
        id: "primary",
        settings,
        updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    throwDatabaseError(error, "save bot settings");

    if (activeBot?.readyState === WebSocket.OPEN) {
        sendBotMessage({ type: "settings_update", settings });
    }
    await addLog("info", "Bot settings updated from the owner dashboard.");
    response.json({ saved: true, botConnected: activeBot?.readyState === WebSocket.OPEN });
}));

app.get("/api/admin/logs", requireOwner, asyncRoute(async (request, response) => {
    const parsedLimit = Number.parseInt(String(request.query.limit ?? "100"), 10);
    const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 100;
    const { data, error } = await supabase
        .from("bot_dashboard_logs")
        .select("id, level, message, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
    throwDatabaseError(error, "read private bot logs");
    response.setHeader("Cache-Control", "no-store");
    response.json({ logs: data ?? [] });
}));

app.post("/api/admin/commands", requireOwner, requireCsrf, asyncRoute(async (request, response) => {
    const validation = validateCommand(request.body, config.allowedCommands);
    if (validation.error) return response.status(400).json({ error: validation.error });
    if (!activeBot || activeBot.readyState !== WebSocket.OPEN ||
        Date.now() - lastHeartbeatAt > config.heartbeatMaxAgeMs) {
        return response.status(503).json({ error: "The bot is offline or has not sent a recent heartbeat." });
    }

    const id = randomUUID();
    const command = validation.value;
    const { error } = await supabase.from("bot_dashboard_commands").insert({
        id,
        command: command.command,
        arguments: command.arguments,
        requested_by: request.ownerSession.userId,
        status: "pending"
    });
    throwDatabaseError(error, "record bot command");

    const resultPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingCommands.delete(id);
            const result = { error: "The bot did not respond before the command timed out." };
            void supabase.from("bot_dashboard_commands")
                .update({ status: "failed", result, completed_at: new Date().toISOString() })
                .eq("id", id)
                .then(({ error: updateError }) => {
                    if (updateError) console.error("Could not mark timed out bot command as failed:", updateError.message);
                });
            reject(Object.assign(new Error(result.error), { status: 504 }));
        }, 30000);
        pendingCommands.set(id, { resolve, reject, timeout, command: command.command });
    });

    if (!sendBotMessage({
        type: "command",
        id,
        command: command.command,
        arguments: command.arguments
    })) {
        const pending = pendingCommands.get(id);
        if (pending) {
            clearTimeout(pending.timeout);
            pendingCommands.delete(id);
        }
        const { error: updateError } = await supabase.from("bot_dashboard_commands")
            .update({ status: "failed", result: { error: "Bot connection closed." }, completed_at: new Date().toISOString() })
            .eq("id", id);
        throwDatabaseError(updateError, "mark unsent bot command as failed");
        return response.status(503).json({ error: "The bot connection closed before the command could be sent." });
    }

    const result = await resultPromise;
    response.json({ id, ...result });
}));

app.use((error, request, response, _next) => {
    console.error("API request failed:", error?.stack ?? error);
    if (response.headersSent) return;
    const status = Number.isInteger(error?.status) ? error.status : 500;
    response.status(status).json({
        error: status >= 500 ? "The request could not be completed." : error.message
    });
});

server.on("upgrade", (request, socket, head) => {
    let url;
    try {
        url = new URL(request.url, config.apiPublicUrl);
    } catch {
        socket.destroy();
        return;
    }
    if (url.pathname !== config.websocketPath || url.search || request.headers.origin) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request);
    });
});

websocketServer.on("connection", (websocket) => {
    let authenticated = false;
    const authTimeout = setTimeout(() => websocket.close(4003, "Authentication required"), 5000);

    websocket.on("message", (data) => {
        let message;
        try {
            message = JSON.parse(data.toString("utf8"));
        } catch {
            websocket.close(4002, "Invalid JSON");
            return;
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) {
            websocket.close(4002, "Invalid message");
            return;
        }

        if (!authenticated) {
            if (message.type !== "authenticate" || !safeEqual(message.token, config.botConnectionSecret)) {
                websocket.close(4003, "Authentication failed");
                return;
            }
            authenticated = true;
            clearTimeout(authTimeout);
            const previousBot = activeBot;
            activeBot = websocket;
            lastHeartbeatAt = 0;
            currentBotStartedAt = null;
            if (previousBot && previousBot !== websocket) previousBot.close(4001, "Replaced by a new bot connection");
            void getBotSettings()
                .then((settings) => {
                    if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: "settings_update", settings }));
                })
                .catch((error) => {
                    console.error("Could not send current settings to bot:", error.message);
                    websocket.close(1011, "Could not load bot settings");
                });
            void addLog("info", "Authenticated bot connection established.")
                .catch((error) => console.error("Could not record bot connection:", error.message));
            websocket.send(JSON.stringify({ type: "authenticated" }));
            return;
        }

        if (activeBot !== websocket) return;

        if (message.type === "heartbeat") {
            const validation = validateHeartbeat(message);
            if (validation.error) {
                websocket.close(4002, validation.error);
                return;
            }
            const startedAt = validation.value.startedAt;
            const heartbeatAt = Date.now();
            currentBotStartedAt = startedAt;
            lastHeartbeatAt = heartbeatAt;
            const approvedGuilds = validation.value.guilds
                .filter((guild) => config.approvedGuildIds.has(guild.guild_id));
            void (async () => {
                const { error: statusError } = await supabase.from("bot_dashboard_status").upsert({
                    id: "primary",
                    online: true,
                    started_at: startedAt,
                    last_heartbeat: new Date(heartbeatAt).toISOString()
                }, { onConflict: "id" });
                throwDatabaseError(statusError, "update bot heartbeat");

                if (approvedGuilds.length) {
                    const { error: guildError } = await supabase.from("bot_dashboard_guilds").upsert(
                        approvedGuilds.map((guild) => ({ ...guild, updated_at: new Date(heartbeatAt).toISOString() })),
                        { onConflict: "guild_id" }
                    );
                    throwDatabaseError(guildError, "update approved server counts");
                    const ids = approvedGuilds.map(({ guild_id }) => guild_id);
                    const stale = [...config.approvedGuildIds].filter((id) => !ids.includes(id));
                    if (stale.length) {
                        const { error } = await supabase.from("bot_dashboard_guilds").delete().in("guild_id", stale);
                        throwDatabaseError(error, "remove inactive approved servers");
                    }
                } else if (config.approvedGuildIds.size) {
                    const { error } = await supabase.from("bot_dashboard_guilds")
                        .delete().in("guild_id", [...config.approvedGuildIds]);
                    throwDatabaseError(error, "remove inactive approved servers");
                }
                if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: "heartbeat_ack" }));
            })().catch((error) => {
                console.error("Could not persist bot heartbeat:", error.message);
                if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: "error", error: "Heartbeat could not be stored." }));
            });
            return;
        }

        if (message.type === "log") {
            if (!["debug", "info", "warn", "error"].includes(message.level) || typeof message.message !== "string") {
                websocket.close(4002, "Invalid log message");
                return;
            }
            void addLog(message.level, message.message)
                .catch((error) => console.error("Could not persist bot log:", error.message));
            return;
        }

        if (message.type === "command_result") {
            const validation = validateCommandResult(message);
            if (validation.error) {
                websocket.close(4002, validation.error);
                return;
            }
            const pending = pendingCommands.get(validation.value.id);
            if (!pending) return;
            clearTimeout(pending.timeout);
            pendingCommands.delete(validation.value.id);
            const result = redactJson(validation.value.result);
            const status = validation.value.success ? "completed" : "failed";
            void supabase.from("bot_dashboard_commands")
                .update({ status, result, completed_at: new Date().toISOString() })
                .eq("id", validation.value.id)
                .then(({ error }) => {
                    throwDatabaseError(error, "save bot command result");
                    pending.resolve({ success: validation.value.success, result });
                })
                .catch((error) => pending.reject(error));
            return;
        }

        websocket.close(4002, "Unsupported message type");
    });

    websocket.on("close", () => {
        clearTimeout(authTimeout);
        if (activeBot !== websocket) return;
        activeBot = null;
        currentBotStartedAt = null;
        const lastHeartbeat = new Date(lastHeartbeatAt || Date.now()).toISOString();
        void supabase.from("bot_dashboard_status")
            .update({ online: false, last_heartbeat: lastHeartbeat })
            .eq("id", "primary")
            .then(({ error }) => {
                if (error) console.error("Could not mark bot offline:", error.message);
            });
        void addLog("warn", "Bot connection closed.")
            .catch((error) => console.error("Could not record bot disconnect:", error.message));
        rejectPendingCommands("The bot disconnected before the command completed.");
    });

    websocket.on("error", (error) => console.error("Bot WebSocket error:", error.message));
});

server.listen(config.port, () => {
    console.log(`Piroma bot dashboard API listening on port ${config.port}`);
}).on("error", (error) => {
    console.error("Could not start Piroma bot dashboard API:", error.message);
    process.exitCode = 1;
});

const retentionTimer = setInterval(() => {
    const now = Date.now();
    const logCutoff = new Date(now - config.botLogRetentionDays * 86400000).toISOString();
    const commandCutoff = new Date(now - config.botCommandRetentionDays * 86400000).toISOString();
    void Promise.all([
        supabase.from("bot_dashboard_logs").delete().lt("created_at", logCutoff),
        supabase.from("bot_dashboard_commands").delete().lt("created_at", commandCutoff)
    ]).then(([logs, commands]) => {
        throwDatabaseError(logs.error, "prune expired bot logs");
        throwDatabaseError(commands.error, "prune expired bot commands");
    }).catch((error) => console.error("Could not prune expired dashboard records:", error.message));
}, 60 * 60 * 1000);
retentionTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        clearInterval(retentionTimer);
        websocketServer.clients.forEach((client) => client.close(1001, "Server shutting down"));
        server.close((error) => {
            if (error) {
                console.error("Could not close API server cleanly:", error.message);
                process.exitCode = 1;
            }
            process.exit();
        });
    });
}
