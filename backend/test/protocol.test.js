import test from "node:test";
import assert from "node:assert/strict";
import { validateCommand, validateCommandResult, validateHeartbeat } from "../lib/protocol.js";

test("heartbeat validates and maps server fields", () => {
    const result = validateHeartbeat({
        startedAt: new Date(Date.now() - 60000).toISOString(),
        guilds: [{ id: "12345678901234567", name: "Piroma", memberCount: 42 }]
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.value.guilds[0], {
        guild_id: "12345678901234567",
        guild_name: "Piroma",
        member_count: 42
    });
});

test("commands require explicit allowlisting and structured arguments", () => {
    assert.deepEqual(validateCommand({ command: "ping", arguments: {} }, ["ping"]).value, {
        command: "ping",
        arguments: {}
    });
    assert.match(validateCommand({ command: "shell", arguments: {} }, ["ping"]).error, /not enabled/);
    assert.match(validateCommand({ command: "ping", arguments: { apiKey: "secret" } }, ["ping"]).error, /Do not store secrets/);
});

test("command results are shape checked", () => {
    assert.equal(validateCommandResult({ id: "request-id", success: true, result: { ok: true } }).error, undefined);
    assert.match(validateCommandResult({ success: true }).error, /id/);
    assert.match(validateCommandResult({ id: "request-id", success: true, result: 123 }).error, /JSON data or text/);
});
