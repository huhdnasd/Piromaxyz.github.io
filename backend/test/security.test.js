import test from "node:test";
import assert from "node:assert/strict";
import { redactJson, redactText, signValue, validateJsonObject, verifyValue } from "../lib/security.js";

test("signed values round-trip and expire", () => {
    const secret = "test-secret-with-more-than-32-characters";
    const value = { userId: "123", exp: 2000 };
    const signed = signValue(value, secret);
    assert.deepEqual(verifyValue(signed, secret, 1000), value);
    assert.equal(verifyValue(signed, "different-secret-with-more-than-32-characters", 1000), null);
    assert.equal(verifyValue(signed, secret, 2000000), null);
});

test("settings and command arguments reject secrets and unsafe keys", () => {
    assert.equal(validateJsonObject({ enabled: true }), null);
    assert.match(validateJsonObject({ botToken: "secret" }), /Do not store secrets/);
    assert.match(validateJsonObject(JSON.parse('{"__proto__":{"polluted":true}}')), /Unsafe object key/);
});

test("log and command-result redaction removes common credentials", () => {
    assert.equal(redactText('{"bot_token":"abc123","password":"hunter2"}'), '{"bot_token":"[REDACTED]","password":"[REDACTED]"}');
    const result = redactJson(JSON.parse('{"__proto__":{"polluted":true},"api_key":"secret","safe":"ok"}'));
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(result.api_key, "[REDACTED]");
    assert.equal({}.polluted, undefined);
});
