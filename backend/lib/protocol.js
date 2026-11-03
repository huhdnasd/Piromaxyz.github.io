import { isPlainObject, validateJsonObject } from "./security.js";

const SNOWFLAKE = /^\d{17,20}$/;
const COMMAND_NAME = /^[a-z][a-z0-9:_-]{0,63}$/;

export function validateHeartbeat(value) {
    if (!isPlainObject(value) || typeof value.startedAt !== "string" || !Array.isArray(value.guilds)) {
        return { error: "Heartbeat must contain a startedAt timestamp and a guilds array." };
    }
    const startedAtMs = Date.parse(value.startedAt);
    if (!Number.isFinite(startedAtMs) || startedAtMs > Date.now() + 5000 || startedAtMs < Date.now() - 5 * 365 * 86400000) {
        return { error: "Heartbeat startedAt timestamp is invalid." };
    }
    if (value.guilds.length > 500) return { error: "Heartbeat contains too many servers." };

    const seen = new Set();
    const guilds = [];
    for (const guild of value.guilds) {
        if (!isPlainObject(guild) || typeof guild.id !== "string" || !SNOWFLAKE.test(guild.id)) {
            return { error: "Each server must have a valid Discord ID." };
        }
        if (seen.has(guild.id)) return { error: "Heartbeat contains duplicate server IDs." };
        seen.add(guild.id);
        if (typeof guild.name !== "string" || guild.name.length > 100) {
            return { error: "Each server name must be at most 100 characters." };
        }
        if (!Number.isSafeInteger(guild.memberCount) || guild.memberCount < 0 || guild.memberCount > 10000000) {
            return { error: "Each server must have a valid member count." };
        }
        guilds.push({
            guild_id: guild.id,
            guild_name: guild.name,
            member_count: guild.memberCount
        });
    }
    return { value: { startedAt: new Date(startedAtMs).toISOString(), guilds } };
}

export function validateCommand(value, allowedCommands) {
    if (!isPlainObject(value) || typeof value.command !== "string" || !COMMAND_NAME.test(value.command)) {
        return { error: "A valid command name is required." };
    }
    if (!allowedCommands.includes(value.command)) return { error: "That bot command is not enabled." };
    const args = value.arguments === undefined ? {} : value.arguments;
    const error = validateJsonObject(args, 4096);
    if (error) return { error };
    return { value: { command: value.command, arguments: args } };
}

export function validateCommandResult(value) {
    if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.success !== "boolean") {
        return { error: "Command result must include an id and success flag." };
    }
    const result = value.result ?? null;
    if (result !== null && !isPlainObject(result) && !Array.isArray(result) && typeof result !== "string") {
        return { error: "Command result must be JSON data or text." };
    }
    let serialized;
    try {
        serialized = JSON.stringify(result);
    } catch {
        return { error: "Command result must be serializable JSON data." };
    }
    if (Buffer.byteLength(serialized, "utf8") > 4096) {
        return { error: "Command result is too large." };
    }
    return { value: { id: value.id, success: value.success, result } };
}
