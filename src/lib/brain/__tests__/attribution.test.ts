import { describe, it, expect } from "vitest";
import { computeAttribution, type AttributionMemoryRow } from "../attribution";

const T0 = new Date("2026-09-19T00:00:00Z");

function row(
  id: string,
  kind: string,
  minutesAgo: number,
  opts: Partial<AttributionMemoryRow> = {}
): AttributionMemoryRow {
  return {
    id,
    cycleId: `c_${id}`,
    kind,
    action: null,
    actionResult: null,
    healthScore: null,
    createdAt: new Date(T0.getTime() - minutesAgo * 60_000),
    ...opts,
  };
}

/** Observation with a health score. */
function obs(id: string, cycleId: string, health: number, minutesAgo: number): AttributionMemoryRow {
  return row(id, "OBSERVATION", minutesAgo, { cycleId, healthScore: health });
}

/** Successful non-NOOP outcome. */
function okOutcome(id: string, cycleId: string, action: string, minutesAgo: number): AttributionMemoryRow {
  return row(id, "OUTCOME", minutesAgo, { cycleId, action, actionResult: "ok" });
}

describe("computeAttribution", () => {
  it("attributes a clean positive window with full confidence", () => {
    // Desc (newest first): post-observation, outcome, baseline observation.
    const rows = [
      obs("o2", "c_cycle2", 0.8, 10),
      okOutcome("k1", "c_cycle1", "RUN_TICK", 20),
      obs("o1", "c_cycle1", 0.6, 30),
    ];
    const a = computeAttribution(rows);
    expect(a).not.toBeNull();
    expect(a).toMatchObject({
      evaluated_cycle_id: "c_cycle1",
      action: "RUN_TICK",
      baseline_health: 0.6,
      post_health: 0.8,
      delta: 0.2,
      result: "POSITIVE",
      confidence: 1,
      confounders: [],
    });
  });

  it("attributes a negative delta", () => {
    const rows = [
      obs("o2", "c2", 0.4, 10),
      okOutcome("k1", "c1", "RUN_TICK", 20),
      obs("o1", "c1", 0.8, 30),
    ];
    const a = computeAttribution(rows);
    expect(a?.delta).toBe(-0.4);
    expect(a?.result).toBe("NEGATIVE");
  });

  it("classifies small deltas inside the significance band as NEUTRAL", () => {
    const rows = [
      obs("o2", "c2", 0.61, 10),
      okOutcome("k1", "c1", "RUN_TICK", 20),
      obs("o1", "c1", 0.6, 30),
    ];
    const a = computeAttribution(rows);
    expect(a?.delta).toBe(0.01);
    expect(a?.result).toBe("NEUTRAL");
  });

  it("halves confidence and lists confounders for shared windows", () => {
    // Two successful actions inside one window: RUN_TICK evaluated second,
    // with the newer RUN_DISCOVERY action confounding its window.
    const rows = [
      obs("o3", "c3", 0.7, 5),
      okOutcome("k2", "c2", "RUN_DISCOVERY", 10),
      okOutcome("k1", "c1", "RUN_TICK", 20),
      obs("o1", "c1", 0.6, 30),
    ];
    const a = computeAttribution(rows, new Set(["c2"])); // c2 already evaluated
    expect(a?.evaluated_cycle_id).toBe("c1");
    expect(a?.confounders).toEqual(["c2"]);
    expect(a?.confidence).toBe(0.5);
    expect(a?.result).toBe("POSITIVE");
  });

  it("returns null while the evaluation window is still open (no post observation)", () => {
    const rows = [
      okOutcome("k1", "c1", "RUN_TICK", 20),
      obs("o1", "c1", 0.6, 30),
    ];
    expect(computeAttribution(rows)).toBeNull();
  });

  it("never evaluates failed, skipped, or NOOP outcomes", () => {
    const rows = [
      obs("o2", "c4", 0.9, 5),
      row("k3", "OUTCOME", 8, { cycleId: "c3", action: "RUN_TICK", actionResult: "LLM_UNAVAILABLE" }),
      row("k2", "OUTCOME", 12, { cycleId: "c2", action: "NOOP", actionResult: "ok" }),
      okOutcome("k1", "c1", "RUN_TICK", 20),
      obs("o1", "c1", 0.6, 30),
    ];
    const a = computeAttribution(rows);
    expect(a?.evaluated_cycle_id).toBe("c1");
  });

  it("skips outcomes that were already evaluated", () => {
    const rows = [
      obs("o2", "c2", 0.8, 10),
      okOutcome("k1", "c1", "RUN_TICK", 20),
      obs("o1", "c1", 0.6, 30),
    ];
    expect(computeAttribution(rows, new Set(["c1"]))).toBeNull();
  });

  it("returns null when the baseline observation is missing or has no health score", () => {
    // No same-cycle observation at all.
    const orphan = [obs("o2", "c2", 0.8, 10), okOutcome("k1", "c1", "RUN_TICK", 20)];
    expect(computeAttribution(orphan)).toBeNull();

    // Same-cycle observation exists but health is unknown (null).
    const unknownHealth = [
      obs("o2", "c2", 0.8, 10),
      okOutcome("k1", "c1", "RUN_TICK", 20),
      row("o1", "OBSERVATION", 30, { cycleId: "c1", healthScore: null }),
    ];
    expect(computeAttribution(unknownHealth)).toBeNull();
  });

  it("returns null for empty memory", () => {
    expect(computeAttribution([])).toBeNull();
  });
});