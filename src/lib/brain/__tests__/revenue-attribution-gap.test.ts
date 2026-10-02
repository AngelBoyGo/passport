import { describe, it, expect } from "vitest";
import { computeAttribution, type AttributionMemoryRow } from "../attribution";

/**
 * T5 — Brain → revenue attribution gap (failure hypotheses F-014, F-079).
 *
 * Observed live: the brain cycles almost always NOOP; when it acts the
 * attribution logs `delta=+0 NEUTRAL`. Root cause: attribution measures only a
 * HEALTH-SCORE delta — there is no revenue dimension. A brain action that earns
 * money but leaves health flat is recorded NEUTRAL, so the brain can never learn
 * which actions make money. This test pins that gap and guards the invariants
 * that DO hold.
 */

const OBS = (cycleId: string, health: number, at: number): AttributionMemoryRow => ({
  id: `obs_${cycleId}`,
  cycleId,
  kind: "OBSERVATION",
  action: null,
  actionResult: null,
  healthScore: health,
  createdAt: new Date(at),
});

const OUT = (cycleId: string, action: string, result: string, at: number): AttributionMemoryRow => ({
  id: `out_${cycleId}`,
  cycleId,
  kind: "OUTCOME",
  action,
  actionResult: result,
  healthScore: null,
  createdAt: new Date(at),
});

describe("F-014 · attribution has no revenue dimension (tracked gap)", () => {
  it("DOCUMENTS THE GAP: a money-earning action with flat health is NEUTRAL", () => {
    // baseline health 1.0 -> action succeeds -> post health 1.0 (revenue not
    // represented as health). rowsDesc is newest-first.
    const rows: AttributionMemoryRow[] = [
      OBS("post", 1.0, 3000),
      OUT("c1", "RUN_LOCUM_SEARCH", "ok", 2000),
      OBS("c1", 1.0, 1000),
    ];
    const a = computeAttribution(rows, new Set());
    expect(a).not.toBeNull();
    expect(a!.action).toBe("RUN_LOCUM_SEARCH");
    expect(a!.delta).toBe(0);
    expect(a!.result).toBe("NEUTRAL");
    // REMEDIATION (F-014/F-079): attribution should also carry a revenue delta
    // (or the brain's action-result should include realized revenue) so an
    // earning action is not scored NEUTRAL.
    expect(Object.keys(a!)).not.toContain("revenue_delta");
  });

  it("a health-improving action is POSITIVE (existing invariant holds)", () => {
    const rows: AttributionMemoryRow[] = [
      OBS("post", 1.0, 3000),
      OUT("c2", "RUN_TICK", "ok", 2000),
      OBS("c2", 0.8, 1000),
    ];
    const a = computeAttribution(rows, new Set());
    expect(a!.result).toBe("POSITIVE");
    expect(a!.delta).toBeCloseTo(0.2, 3);
  });

  it("a NOOP is never attributable (only real actions are evaluated)", () => {
    const rows: AttributionMemoryRow[] = [
      OBS("post", 0.9, 3000),
      OUT("c3", "NOOP", "ok", 2000),
      OBS("c3", 0.8, 1000),
    ];
    expect(computeAttribution(rows, new Set())).toBeNull();
  });

  it("already-evaluated cycles are not re-attributed (no double-count)", () => {
    const rows: AttributionMemoryRow[] = [
      OBS("post", 1.0, 3000),
      OUT("c4", "RUN_TICK", "ok", 2000),
      OBS("c4", 0.8, 1000),
    ];
    expect(computeAttribution(rows, new Set(["c4"]))).toBeNull();
  });
});
