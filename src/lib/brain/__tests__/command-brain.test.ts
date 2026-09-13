import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    brainMemory: { findMany: vi.fn(), create: vi.fn() },
    railSpec: { count: vi.fn(), findUnique: vi.fn() },
    computeDispute: { count: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  runBrainCycle,
  summarizePlaybook,
  computeHealthScore,
  BRAIN_ACTIONS,
  type BrainDatapoints,
} from "../command-brain";

const DATAPOINTS: BrainDatapoints = {
  economy: { supply_angel: 100 },
  integrity: { ok: true, issues: [] },
  rails: { enabled: 3, quarantined: 0 },
  disputes_open: 0,
  health_score: 1,
};

describe("command brain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.brainMemory.findMany.mockResolvedValue([]);
    prismaMock.brainMemory.create.mockResolvedValue({ id: "m1" });
    prismaMock.railSpec.count.mockResolvedValue(0);
    prismaMock.computeDispute.count.mockResolvedValue(0);
  });

  it("executes an allowlisted action chosen by the model and records memory", async () => {
    const act = vi.fn().mockResolvedValue("ok");
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "RUN_TICK", params: {}, rationale: "cadence", confidence: 0.8 }),
      act,
    });
    expect(report).toMatchObject({ action: "RUN_TICK", executed: true, action_result: "ok", confidence: 0.8 });
    expect(act).toHaveBeenCalledWith("RUN_TICK", {});
    // OBSERVATION + DECISION + OUTCOME
    expect(prismaMock.brainMemory.create).toHaveBeenCalledTimes(3);
    const kinds = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(["OBSERVATION", "DECISION", "OUTCOME"]);
  });

  it("defaults to NOOP when the model proposes an action outside the allowlist", async () => {
    const act = vi.fn().mockResolvedValue("ok");
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "MINT_MONEY", params: {}, rationale: "no", confidence: 0.9 }),
      act,
    });
    expect(report.action).toBe("NOOP");
    expect(report.rationale).toContain("allowlist");
    expect(act).toHaveBeenCalledWith("NOOP", {});
    expect(BRAIN_ACTIONS).not.toContain("MINT_MONEY");
  });

  it("fails closed to NOOP when the LLM is unavailable (no OUTCOME recorded)", async () => {
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => {
        throw new Error("gateway 503");
      },
      act: vi.fn(),
    });
    expect(report.action).toBe("NOOP");
    expect(report.executed).toBe(false);
    expect(report.error).toContain("gateway 503");
    // OBSERVATION + DECISION only (no action executed)
    const kinds = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(["OBSERVATION", "DECISION"]);
  });

  it("summarizePlaybook computes per-action success rates", () => {
    const pb = summarizePlaybook([
      { action: "RUN_TICK", actionResult: "ok" },
      { action: "RUN_TICK", actionResult: "ok" },
      { action: "RUN_TICK", actionResult: "error: x" },
      { action: "NOOP", actionResult: "ok" },
    ]);
    expect(pb.RUN_TICK).toEqual({ attempts: 3, successes: 2, successRate: 0.67 });
    expect(pb.NOOP.successRate).toBe(1);
  });

  it("computeHealthScore penalizes under-collateralization, integrity failure, disputes", () => {
    expect(computeHealthScore({ reserve_adequate: true }, { ok: true }, 0)).toBe(1);
    expect(computeHealthScore({ reserve_adequate: false }, { ok: true }, 0)).toBeCloseTo(0.6, 3);
    expect(computeHealthScore({ reserve_adequate: true }, { ok: false }, 0)).toBeCloseTo(0.6, 3);
    expect(computeHealthScore({ reserve_adequate: true }, { ok: true }, 10)).toBeCloseTo(0.8, 3);
  });
});