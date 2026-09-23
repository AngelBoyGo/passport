import { describe, expect, it } from "vitest";
import {
  assertOrderAgreement,
  hourlyRate,
  isLocumJob,
  ORDER_VERSION,
  rankJobsByPay,
} from "../pay-ranker";
import fixture from "../fixtures/pay-rank-jobs.json";

describe("pay-ranker (brain mirror) — shared fixture contract", () => {
  const jobs = fixture.jobs as Array<Record<string, unknown>>;
  const result = rankJobsByPay({ jobs, payFloor: fixture.payFloor });

  it("pins the ordering contract version (must match Callora's)", () => {
    expect(ORDER_VERSION).toBe("pay-v1");
  });

  it("produces the EXACT expected order shared with Callora", () => {
    expect(result.ranked.map((r) => r.job.id)).toEqual(fixture.expectedRankedIds);
  });

  it("normalizes every rate shape identically to Callora", () => {
    for (const [id, rate] of Object.entries(fixture.expectedRates)) {
      const row = result.ranked.find((r) => r.job.id === id);
      expect(row, `expected ${id} ranked`).toBeTruthy();
      expect(row!.rate).toBe(rate);
    }
  });

  it("excludes with the same honest reasons", () => {
    const excluded = result.excluded.map((e) => ({ id: e.job.id, reason: e.reason }));
    for (const exp of fixture.expectedExcluded) {
      expect(excluded).toContainEqual(exp);
    }
  });
});

describe("brain mirror — edge parity", () => {
  it("day rate conversion by shift length matches Callora's", () => {
    expect(hourlyRate({ comp_display: "$4,800/day" })).toBe(400);
    expect(hourlyRate({ comp_display: "$4,800/day", shift_hours: 10 })).toBe(480);
  });

  it("locum detection parity across both field spellings", () => {
    expect(isLocumJob({ type: "locum" })).toBe(true);
    expect(isLocumJob({ job_type: "Locums/Travel" })).toBe(true);
    expect(isLocumJob({ type: "permanent" })).toBe(false);
    expect(isLocumJob({})).toBe(true);
  });

  it("null rate, never a phantom estimate", () => {
    expect(hourlyRate({ title: "x" })).toBeNull();
  });

  it("bill_rate_per_day is NOT physician pay (parity with Callora)", () => {
    // Audit 2026-09-23: the brain used to treat the facility BILL rate as the
    // physician's rate — overstating earnings and diverging from Callora.
    // It is deliberately not a rate source now.
    expect(hourlyRate({ bill_rate_per_day: 6000 })).toBeNull();
    // ...but an explicit physician rate still wins alongside a bill rate.
    expect(hourlyRate({ bill_rate_per_day: 6000, rate_per_hour: 410 })).toBe(410);
  });
});

describe("runtime order-agreement (the drift guard)", () => {
  const rateOf = (id: string) =>
    ({ "top": 465, "mid": 390, "low": 360, "alt": 390 })[id] ?? null;

  it("perfect agreement", () => {
    const a = assertOrderAgreement(["top", "mid", "alt"], ["top", "mid", "alt"], rateOf);
    expect(a.agree).toBe(true);
    expect(a.rank1_match).toBe(true);
    expect(a.transpositions).toBe(0);
  });

  it("EQUAL-RATE swaps are tolerated (ties are order-unstable, not drift)", () => {
    // mid and alt both rate 390 — a swap between them is a tie, not drift.
    const a = assertOrderAgreement(["top", "mid", "alt"], ["top", "alt", "mid"], rateOf);
    expect(a.agree).toBe(true);
    expect(a.transpositions).toBe(0);
  });

  it("DIFFERENT-rate order changes are drift", () => {
    const a = assertOrderAgreement(["top", "mid", "alt"], ["top", "alt", "mid"], (id) =>
      id === "mid" ? 390 : id === "alt" ? 385 : 465
    );
    expect(a.agree).toBe(false);
    expect(a.transpositions).toBeGreaterThan(0);
  });

  it("rank-1 disagreement is ALWAYS drift, even with zero other moves", () => {
    const a = assertOrderAgreement(["mid", "top"], ["top", "mid"], rateOf);
    expect(a.rank1_match).toBe(false);
    expect(a.agree).toBe(false);
  });

  it("a missing brain entry is maximum drift (shape divergence detected)", () => {
    const a = assertOrderAgreement(["top", "mid", "alt"], ["top"], rateOf);
    expect(a.agree).toBe(false);
  });
});
