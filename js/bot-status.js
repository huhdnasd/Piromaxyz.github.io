import { BOT_API_BASE_URL } from "./bot-dashboard-config.js";

const status = document.querySelector("#live-bot-status");
if (status) {
    const uptime = document.querySelector("#live-bot-uptime");
    const memberCount = document.querySelector("#live-approved-members");
    const serverList = document.querySelector("#live-approved-servers");
    const updated = document.querySelector("#live-bot-last-seen");

    const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
    };

    const updateStatus = async () => {
        try {
            const response = await fetch(`${BOT_API_BASE_URL}/api/public/status`, {
                headers: { Accept: "application/json" },
                cache: "no-store"
            });
            if (!response.ok) throw new Error(`Status API returned HTTP ${response.status}.`);
            const data = await response.json();

            status.textContent = data.status === "online" ? "Online" : "Offline";
            status.classList.toggle("online", data.status === "online");
            status.classList.toggle("offline", data.status !== "online");
            uptime.textContent = data.uptimeSeconds === null ? "—" : formatUptime(data.uptimeSeconds);
            memberCount.textContent = Number(data.approvedMemberCount).toLocaleString();
            serverList.replaceChildren();

            if (data.approvedServers.length) {
                for (const server of data.approvedServers) {
                    const row = document.createElement("li");
                    const name = document.createElement("span");
                    const count = document.createElement("strong");
                    name.textContent = server.name;
                    count.textContent = Number(server.memberCount).toLocaleString();
                    row.append(name, count);
                    serverList.append(row);
                }
            } else {
                const empty = document.createElement("li");
                empty.textContent = "No approved server data has been received yet.";
                serverList.append(empty);
            }

            updated.textContent = data.lastSeen
                ? `Last bot heartbeat: ${new Date(data.lastSeen).toLocaleString()}`
                : "Waiting for the bot to connect.";
            status.dataset.loaded = "true";
        } catch (error) {
            console.error("Could not load live bot status:", error);
            status.textContent = "Status unavailable";
            status.classList.remove("online", "offline");
            uptime.textContent = "—";
            memberCount.textContent = "—";
            updated.textContent = "The live status service is currently unavailable.";
        }
    };

    updateStatus();
    window.setInterval(updateStatus, 15000);
}
