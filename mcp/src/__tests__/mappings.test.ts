import { describe, expect, it } from "vitest";
import {
  deriveCloseStatus,
  defaultExpiry,
  generateAgentId,
  mapErrorToTranche,
} from "../mappings.js";

describe("deriveCloseStatus", () => {
  it("maps NONE to graceful_shutdown", () => {
    expect(deriveCloseStatus("NONE")).toBe("graceful_shutdown");
  });

  it("maps error tranches to failure_tombstone", () => {
    expect(deriveCloseStatus("COMPUTE_TIMEOUT")).toBe("failure_tombstone");
    expect(deriveCloseStatus("LOGIC_DETECTION")).toBe("failure_tombstone");
    expect(deriveCloseStatus("SLA_BREACH")).toBe("failure_tombstone");
    expect(deriveCloseStatus("DATA_LEAKAGE")).toBe("failure_tombstone");
  });
});

describe("defaultExpiry", () => {
  it("returns ISO-8601 string approximately 30 days from now", () => {
    const before = Date.now();
    const expiry = defaultExpiry();
    const after = Date.now();

    const parsed = Date.parse(expiry);
    expect(Number.isNaN(parsed)).toBe(false);

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(parsed).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    expect(parsed).toBeLessThanOrEqual(after + thirtyDaysMs + 1000);
    expect(expiry).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("generateAgentId", () => {
  it("is deterministic for the same host and cwd", () => {
    const first = generateAgentId();
    const second = generateAgentId();
    expect(first).toBe(second);
    expect(first).toMatch(/^agent_[a-f0-9]{16}$/);
  });
});

describe("mapErrorToTranche", () => {
  it("maps timeout/abort/ECONN errors to COMPUTE_TIMEOUT", () => {
    expect(mapErrorToTranche(new DOMException("Aborted", "AbortError"))).toBe(
      "COMPUTE_TIMEOUT"
    );
    expect(mapErrorToTranche(new Error("request timeout"))).toBe(
      "COMPUTE_TIMEOUT"
    );
    const connErr = new Error("connect failed");
    (connErr as NodeJS.ErrnoException).code = "ECONNREFUSED";
    expect(mapErrorToTranche(connErr)).toBe("COMPUTE_TIMEOUT");
  });

  it("maps validation/type errors to LOGIC_DETECTION", () => {
    expect(mapErrorToTranche(new TypeError("invalid type"))).toBe(
      "LOGIC_DETECTION"
    );
    const validationErr = new Error("validation failed");
    validationErr.name = "ValidationError";
    expect(mapErrorToTranche(validationErr)).toBe("LOGIC_DETECTION");
  });

  it("defaults unknown errors to SLA_BREACH", () => {
    expect(mapErrorToTranche(new Error("something broke"))).toBe("SLA_BREACH");
  });
});
