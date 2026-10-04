import { describe, expect, it } from "vitest";
import { heartbeatsAgeMs } from "../dual-state-governor";

describe("governor telemetry heartbeat age (audit H4)", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("returns the age of the FRESHEST heartbeat", () => {
    const ages = heartbeatsAgeMs(
      [
        { lastSeenAt: new Date("2026-10-04T11:00:00Z") }, // 60 min
        { lastSeenAt: new Date("2026-10-04T11:50:00Z") }, // 10 min
      ],
      now
    );
    expect(ages).toBe(10 * 60_000);
  });

  it("returns a large value when there are NO heartbeats (treat as stale)", () => {
    expect(heartbeatsAgeMs([], now)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("a heartbeat older than the 15-minute window is detectably stale", () => {
    const age = heartbeatsAgeMs([{ lastSeenAt: new Date("2026-10-04T11:40:00Z") }], now);
    expect(age).toBeGreaterThan(15 * 60_000);
  });
});
