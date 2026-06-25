import { createHash } from "node:crypto";
import { hostname } from "node:os";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Derives finalize status from error tranche.
 */
export function deriveCloseStatus(errorTranche) {
    return errorTranche === "NONE" ? "graceful_shutdown" : "failure_tombstone";
}
/**
 * Returns ISO-8601 expiry string 30 days from now.
 */
export function defaultExpiry(now = Date.now()) {
    return new Date(now + THIRTY_DAYS_MS).toISOString();
}
/**
 * Deterministic agent id from host + cwd.
 */
export function generateAgentId(host = hostname(), cwd = process.cwd()) {
    const digest = createHash("sha256")
        .update(`${host}:${cwd}`)
        .digest("hex")
        .slice(0, 16);
    return `agent_${digest}`;
}
/**
 * Maps thrown errors to Passport error tranches.
 */
export function mapErrorToTranche(err) {
    if (err instanceof DOMException && err.name === "AbortError") {
        return "COMPUTE_TIMEOUT";
    }
    if (err instanceof Error) {
        const message = err.message.toLowerCase();
        const code = err.code;
        if (message.includes("timeout") ||
            message.includes("abort") ||
            message.includes("econn") ||
            code?.startsWith("ECONN")) {
            return "COMPUTE_TIMEOUT";
        }
        if (err instanceof TypeError ||
            err.name === "ValidationError" ||
            message.includes("validation") ||
            message.includes("invalid")) {
            return "LOGIC_DETECTION";
        }
    }
    return "SLA_BREACH";
}
