import { describe, it, expect } from "vitest";
import {
  redemptionQuote,
  parityStatus,
  revenueIssuanceQuote,
  PARITY_USD,
  PARITY_REDEMPTION_FEE_BPS,
  STABILITY_CONTRACT,
} from "../parity";

describe("ANGEL parity redemption (stability contract)", () => {
  it("defines a fixed parity anchor and a small fee (not a punitive exit spread)", () => {
    expect(PARITY_USD).toBe(5.0);
    expect(PARITY_REDEMPTION_FEE_BPS).toBeGreaterThanOrEqual(0);
    expect(PARITY_REDEMPTION_FEE_BPS).toBeLessThan(100); // < 1%, far below the old 5% spread
    expect(STABILITY_CONTRACT.peg).toContain("$5.00");
  });

  it("redeems at parity minus a small reserve/community fee", () => {
    const q = redemptionQuote({ angelAmount: 100, supplyAngel: 1000, reserveUsd: 5000, feeBps: 30 });
    expect(q.grossUsd).toBe(500);
    expect(q.feeUsd).toBe(1.5);
    expect(q.netUsd).toBe(498.5);
    expect(q.reserveAdequate).toBe(true);
    expect(q.coverageRatio).toBe(1);
    expect(q.redeemable).toBe(true);
    expect(q.reason).toBeUndefined();
  });

  it("reports a reserve surplus when over-collateralized (buffer, not a price rise)", () => {
    const s = parityStatus({ supplyAngel: 1000, reserveUsd: 7500 });
    expect(s.requiredReserveUsd).toBe(5000);
    expect(s.coverageRatio).toBe(1.5);
    expect(s.reserveAdequate).toBe(true);
    expect(s.surplusUsd).toBe(2500);
  });

  it("flags under-collateralization and caps redemption at the reserve", () => {
    const s = parityStatus({ supplyAngel: 1000, reserveUsd: 2500 });
    expect(s.coverageRatio).toBe(0.5);
    expect(s.reserveAdequate).toBe(false);
    expect(s.surplusUsd).toBe(-2500);

    // A small redemption still clears (covered by the reserve)...
    const small = redemptionQuote({ angelAmount: 100, supplyAngel: 1000, reserveUsd: 2500, feeBps: 30 });
    expect(small.redeemable).toBe(true);
    // ...but one larger than the reserve is capped, with a clear reason.
    const big = redemptionQuote({ angelAmount: 1000, supplyAngel: 1000, reserveUsd: 2500, feeBps: 30 });
    expect(big.redeemable).toBe(false);
    expect(big.maxRedeemableAngel).toBe(Math.floor(2500 / (5 * 0.997)));
    expect(big.reason).toContain("capped");
  });

  it("honors a zero-fee redemption at exactly parity", () => {
    const q = redemptionQuote({ angelAmount: 10, supplyAngel: 10, reserveUsd: 50, feeBps: 0 });
    expect(q.feeUsd).toBe(0);
    expect(q.netUsd).toBe(50);
    expect(q.redeemable).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    const q = redemptionQuote({ angelAmount: 0, supplyAngel: 10, reserveUsd: 50 });
    expect(q.redeemable).toBe(false);
    expect(q.reason).toContain("positive");
  });

  it("treats an empty system as fully backed (nothing to redeem)", () => {
    const q = redemptionQuote({ angelAmount: 1, supplyAngel: 0, reserveUsd: 0 });
    expect(q.requiredReserveUsd).toBe(0);
    expect(q.coverageRatio).toBe(1);
    expect(q.reserveAdequate).toBe(true);
    // no reserve to pay from
    expect(q.redeemable).toBe(false);
    expect(q.maxRedeemableAngel).toBe(0);
  });

  it("revenue issuance never dilutes backing (coverage non-decreasing)", () => {
    const q = revenueIssuanceQuote({ grossUsdCents: 600, supplyAngel: 100, reserveUsd: 520 });
    expect(q.angelCredited).toBe(1);
    expect(q.reserveUsdAdded).toBe(6);
    expect(q.coverageAfter).toBeGreaterThanOrEqual(q.coverageBefore);
    expect(q.backed).toBe(true);
  });
});
