import WebSocket from "ws";

const HEARTBEAT_INTERVAL_MS = 15000;
const RECONNECT_MAX_MS = 30000;
const SECRET_PATTERN = /(token|secret|password|credential|api.?key)\s*[:=]\s*([^\s,;]+)/gi;

function redact(message) {
    return String(message)
        .replace(SECRET_PATTERN, "$1=[REDACTED]")
        .replace(/\b[\w-]{24}\.[\w-]{6}\.[\w-]{20,}\b/g, "[REDACTED]");
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startDashboardConnector({
    apiUrl,
    connectionSecret,
    allowedCommands,
    getGuilds,
    getUptimeMs,
    runCommand,
    applySettings,
    logger = console
}) {
    if (!apiUrl || !connectionSecret || !Array.isArray(allowedCommands) ||
        !getGuilds || !getUptimeMs || !runCommand || !applySettings) {
        throw new Error("The dashboard connector requires API URL, secret, and bot adapter callbacks.");
    }
    const socketUrl = new URL("/bot/connect", apiUrl);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    let stopped = false;
    let socket;

    const report = (level, message) => {
        const safeMessage = redact(message).slice(0, 1900);
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "log", level, message: safeMessage }));
        }
    };

    const connect = async () => {
        let retry = 1000;
        while (!stopped) {
            const connection = new WebSocket(socketUrl, { maxPayload: 16 * 1024 });
            socket = connection;
            await new Promise((resolve) => {
                let authenticated = false;
                let heartbeat;
                const finish = () => {
                    clearInterval(heartbeat);
                    resolve();
                };

                connection.once("open", () => {
                    connection.send(JSON.stringify({ type: "authenticate", token: connectionSecret }));
                });
                connection.on("message", async (raw) => {
                    let message;
                    try {
                        message = JSON.parse(raw.toString("utf8"));
                    } catch (error) {
                        logger.error("Piroma dashboard sent invalid JSON:", error);
                        connection.close();
                        return;
                    }

                    if (!authenticated && message.type === "authenticated") {
                        authenticated = true;
                        retry = 1000;
                        const sendHeartbeat = async () => {
                            try {
                                const guilds = await getGuilds();
                                if (connection.readyState !== WebSocket.OPEN) return;
                                connection.send(JSON.stringify({
                                    type: "heartbeat",
                                    startedAt: new Date(Date.now() - getUptimeMs()).toISOString(),
                                    guilds
                                }));
                            } catch (error) {
                                logger.error("Could not send Piroma dashboard heartbeat:", error);
                                report("error", `Heartbeat failed: ${error.message}`);
                            }
                        };
                        await sendHeartbeat();
                        if (connection.readyState === WebSocket.OPEN) {
                            heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
                        }
                        return;
                    }

                    if (message.type === "settings_update") {
                        try {
                            await applySettings(message.settings);
                        } catch (error) {
                            logger.error("Could not apply Piroma dashboard settings:", error);
                            report("error", `Settings update failed: ${error.message}`);
                        }
                        return;
                    }

                    if (message.type === "command" && typeof message.id === "string") {
                        if (!allowedCommands.includes(message.command)) {
                            connection.send(JSON.stringify({
                                type: "command_result",
                                id: message.id,
                                success: false,
                                result: { error: "Command is not enabled by the bot project." }
                            }));
                            return;
                        }
                        try {
                            const result = await runCommand(message.command, message.arguments ?? {});
                            if (connection.readyState !== WebSocket.OPEN) return;
                            connection.send(JSON.stringify({
                                type: "command_result",
                                id: message.id,
                                success: true,
                                result: result ?? null
                            }));
                        } catch (error) {
                            logger.error("Piroma dashboard command failed:", error);
                            if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({
                                type: "command_result",
                                id: message.id,
                                success: false,
                                result: { error: redact(error.message ?? "Command failed") }
                            }));
                            report("error", `Remote command failed: ${error.message}`);
                        }
                    }
                });
                connection.once("close", finish);
                connection.once("error", (error) => {
                    logger.error("Piroma dashboard connection error:", error);
                    finish();
                });
            });

            if (stopped) break;
            await wait(retry + Math.floor(Math.random() * 500));
            retry = Math.min(retry * 2, RECONNECT_MAX_MS);
        }
    };

    void connect().catch((error) => logger.error("Piroma dashboard connector stopped unexpectedly:", error));
    return () => {
        stopped = true;
        socket?.close(1000, "Bot shutting down");
    };
}
