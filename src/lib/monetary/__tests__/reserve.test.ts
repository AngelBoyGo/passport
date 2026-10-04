import { describe, expect, it } from "vitest";
import { fiatReserveUsdFromEntries, RESERVE_KINDS } from "../reserve";

describe("reserve accounting (audit C1/C2/M7)", () => {
  it("sums signed deltas — a redemption LOWERS the reserve", () => {
    // $500 top-up, then a $200 redemption outflow (negative).
    const entries = [
      { deltaMicros: 500 * 100 * 10_000 },
      { deltaMicros: -200 * 100 * 10_000 },
    ];
    expect(fiatReserveUsdFromEntries(entries)).toBe(300);
  });

  it("does NOT use Math.abs (a negative delta never increases the reserve)", () => {
    const entries = [{ deltaMicros: -50 * 100 * 10_000 }];
    expect(fiatReserveUsdFromEntries(entries)).toBe(0);
  });

  it("floors at 0 (a reserve is never negative on paper)", () => {
    const entries = [{ deltaMicros: 10 * 100 * 10_000 }, { deltaMicros: -999 * 100 * 10_000 }];
    expect(fiatReserveUsdFromEntries(entries)).toBe(0);
  });

  it("includes redemption outflow kinds (not inflow-only)", () => {
    expect(RESERVE_KINDS).toContain("rwa_redemption_queued");
    expect(RESERVE_KINDS).toContain("angl_redemption");
    expect(RESERVE_KINDS).toContain("external_revenue");
  });
});
