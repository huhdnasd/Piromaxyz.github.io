import { createHmac, timingSafeEqual } from "node:crypto";

const SENSITIVE_KEY = /(token|secret|password|credential|api.?key|authorization)/i;
const SENSITIVE_TEXT = [
    /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
    /(["']?(?:bot[_ -]?)?token["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
    /(["']?(?:client[_ -]?)?secret["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
    /(["']?(?:password|api[_ -]?key)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
    /\b[\w-]{24}\.[\w-]{6}\.[\w-]{20,}\b/g
];

export function signValue(value, secret) {
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signature = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${signature}`;
}

export function verifyValue(signedValue, secret, now = Date.now()) {
    if (typeof signedValue !== "string") return null;
    const separator = signedValue.lastIndexOf(".");
    if (separator <= 0) return null;

    const body = signedValue.slice(0, separator);
    const signature = signedValue.slice(separator + 1);
    const expected = createHmac("sha256", secret).update(body).digest();
    let supplied;
    try {
        supplied = Buffer.from(signature, "base64url");
    } catch {
        return null;
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    try {
        const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!value || typeof value !== "object" || !Number.isInteger(value.exp) || value.exp <= Math.floor(now / 1000)) {
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

export function parseCookies(header = "") {
    const cookies = new Map();
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 1) continue;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (!cookies.has(name)) cookies.set(name, value);
    }
    return cookies;
}

export function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function validateJsonObject(value, maxBytes = 8192) {
    if (!isPlainObject(value)) return "Expected a JSON object.";
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) return `Object exceeds ${maxBytes} bytes.`;

    const inspect = (item, depth) => {
        if (depth > 8) return "Object is nested too deeply.";
        if (Array.isArray(item)) {
            if (item.length > 100) return "Arrays may contain at most 100 values.";
            for (const entry of item) {
                const error = inspect(entry, depth + 1);
                if (error) return error;
            }
            return null;
        }
        if (item && typeof item === "object") {
            for (const [key, entry] of Object.entries(item)) {
                if (["__proto__", "prototype", "constructor"].includes(key)) return "Unsafe object key.";
                if (SENSITIVE_KEY.test(key)) return "Do not store secrets in dashboard settings or command arguments.";
                const error = inspect(entry, depth + 1);
                if (error) return error;
            }
        }
        if (typeof item === "string" && item.length > 4000) return "String values may not exceed 4000 characters.";
        if (typeof item === "number" && !Number.isFinite(item)) return "Numbers must be finite.";
        if (item !== null && !["string", "number", "boolean", "object"].includes(typeof item)) {
            return "Unsupported JSON value.";
        }
        return null;
    };

    return inspect(value, 0);
}

export function redactText(value) {
    let message = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
    for (const pattern of SENSITIVE_TEXT) {
        message = message.replace(pattern, (_, prefix) => `${prefix ?? ""}[REDACTED]`);
    }
    return message.slice(0, 2000);
}

export function redactJson(value) {
    if (Array.isArray(value)) return value.map(redactJson);
    if (!value || typeof value !== "object") {
        return typeof value === "string" ? redactText(value) : value;
    }
    const result = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
        result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactJson(entry);
    }
    return result;
}
