import { BOT_API_BASE_URL } from "./bot-dashboard-config.js";

const login = document.querySelector("#bot-admin-login");
const dashboard = document.querySelector("#bot-admin-dashboard");
const message = document.querySelector("#bot-admin-message");
const loginLink = document.querySelector("#bot-discord-login");
const userLabel = document.querySelector("#bot-admin-user");
const settingsForm = document.querySelector("#bot-settings-form");
const settingsInput = document.querySelector("#bot-settings");
const commandForm = document.querySelector("#bot-command-form");
const commandSelect = document.querySelector("#bot-command");
const commandArguments = document.querySelector("#bot-command-arguments");
const commandButton = document.querySelector("#bot-run-command");
const logsList = document.querySelector("#bot-private-logs");
let csrfToken = "";

function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error-message", isError);
}

async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);

    const response = await fetch(`${BOT_API_BASE_URL}${path}`, {
        ...options,
        headers,
        credentials: "include",
        cache: "no-store"
    });
    if (response.status === 204) return null;
    const data = await response.json();
    if (response.status === 401) {
        csrfToken = "";
        dashboard.hidden = true;
        login.hidden = false;
        settingsInput.value = "";
        logsList.replaceChildren();
    }
    if (!response.ok) throw new Error(data.error ?? `Request failed with HTTP ${response.status}.`);
    return data;
}

function renderLogs(logs) {
    logsList.replaceChildren();
    if (!logs.length) {
        const empty = document.createElement("li");
        empty.textContent = "No private logs have been received.";
        logsList.append(empty);
        return;
    }
    for (const log of logs) {
        const row = document.createElement("li");
        const meta = document.createElement("small");
        const content = document.createElement("p");
        meta.textContent = `${new Date(log.created_at).toLocaleString()} · ${log.level}`;
        content.textContent = log.message;
        row.append(meta, content);
        logsList.append(row);
    }
}

async function loadDashboard() {
    const [session, adminData] = await Promise.all([
        api("/api/session"),
        api("/api/admin")
    ]);
    if (!session.authenticated) throw new Error("Your owner session has expired. Sign in again.");
    csrfToken = session.csrfToken;
    userLabel.textContent = `Signed in as ${session.user.username} (${session.user.id})`;
    settingsInput.value = JSON.stringify(adminData.settings, null, 2);

    commandSelect.replaceChildren();
    const commands = adminData.allowedCommands;
    if (!commands.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No commands enabled";
        commandSelect.append(option);
        commandButton.disabled = true;
    } else {
        for (const command of commands) {
            const option = document.createElement("option");
            option.value = command;
            option.textContent = command;
            commandSelect.append(option);
        }
        commandButton.disabled = false;
    }

    const logData = await api("/api/admin/logs?limit=100");
    renderLogs(logData.logs);
    login.hidden = true;
    dashboard.hidden = false;
}

loginLink.href = `${BOT_API_BASE_URL}/auth/discord`;
settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    let settings;
    try {
        settings = JSON.parse(settingsInput.value);
    } catch {
        setMessage("Settings must be valid JSON.", true);
        return;
    }
    const button = settingsForm.querySelector("button[type=submit]");
    button.disabled = true;
    setMessage("Saving settings...");
    try {
        const result = await api("/api/admin/settings", {
            method: "PUT",
            body: JSON.stringify({ settings })
        });
        setMessage(result.botConnected
            ? "Settings saved and sent to the connected bot."
            : "Settings saved. They will be sent when the bot connects.");
    } catch (error) {
        setMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
});

commandForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    let args;
    try {
        args = JSON.parse(commandArguments.value || "{}");
    } catch {
        setMessage("Command arguments must be valid JSON.", true);
        return;
    }
    commandButton.disabled = true;
    setMessage("Waiting for the bot to execute this command...");
    try {
        const result = await api("/api/admin/commands", {
            method: "POST",
            body: JSON.stringify({ command: commandSelect.value, arguments: args })
        });
        setMessage(`Command ${result.success ? "completed" : "failed"}: ${JSON.stringify(result.result)}`, !result.success);
        const logData = await api("/api/admin/logs?limit=100");
        renderLogs(logData.logs);
    } catch (error) {
        setMessage(error.message, true);
    } finally {
        commandButton.disabled = commandSelect.options.length === 0 || !commandSelect.value;
    }
});

document.querySelector("#bot-refresh-logs").addEventListener("click", async () => {
    try {
        const logData = await api("/api/admin/logs?limit=100");
        renderLogs(logData.logs);
        setMessage("Private logs refreshed.");
    } catch (error) {
        setMessage(error.message, true);
    }
});

document.querySelector("#bot-admin-logout").addEventListener("click", async () => {
    try {
        await api("/auth/logout", { method: "POST" });
        csrfToken = "";
        dashboard.hidden = true;
        login.hidden = false;
        setMessage("Signed out.");
    } catch (error) {
        setMessage(error.message, true);
    }
});

const loginState = new URLSearchParams(window.location.search).get("login");
if (loginState === "denied") setMessage("That Discord account is not the configured bot owner.", true);
if (loginState === "failed") setMessage("Discord sign-in failed. Check the OAuth configuration and try again.", true);
if (loginState === "cancelled") setMessage("Discord sign-in was cancelled.", true);

api("/api/session")
    .then(async (session) => {
        if (!session.authenticated) {
            if (!loginState) setMessage("Sign in with the Discord account configured as the owner.");
            return;
        }
        csrfToken = session.csrfToken;
        window.setTimeout(() => {
            csrfToken = "";
            dashboard.hidden = true;
            login.hidden = false;
            settingsInput.value = "";
            logsList.replaceChildren();
            setMessage("Your owner session expired. Sign in again.");
        }, Math.max(0, session.expiresAt - Date.now()));
        await loadDashboard();
    })
    .catch((error) => setMessage(error.message, true));
