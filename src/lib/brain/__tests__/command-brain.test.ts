import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    brainMemory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    brainLease: { updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
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
    prismaMock.brainMemory.findFirst.mockResolvedValue(null);
    prismaMock.brainMemory.create.mockResolvedValue({ id: "m1" });
    prismaMock.brainLease.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.brainLease.create.mockRejectedValue(new Error("exists"));
    prismaMock.brainLease.deleteMany.mockResolvedValue({ count: 1 });
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
    expect(report.outcome_class).toBe("ACTION_SUCCEEDED");
    expect(act).toHaveBeenCalledWith("RUN_TICK", {});
    // OBSERVATION + DECISION + OUTCOME
    expect(prismaMock.brainMemory.create).toHaveBeenCalledTimes(3);
    const kinds = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(["OBSERVATION", "DECISION", "OUTCOME"]);
    // Lease is released after the cycle
    expect(prismaMock.brainLease.deleteMany).toHaveBeenCalled();
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

  it("fails closed to NOOP when the LLM is unavailable, recording an LLM_UNAVAILABLE outcome", async () => {
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
    // Phase 40: failures are recorded. No DECISION exists (the LLM produced
    // nothing to decide) — the honest trail is OBSERVATION + OUTCOME.
    const kinds = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(["OBSERVATION", "OUTCOME"]);
    const outcome = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { actionResult: string } }).data.actionResult);
    expect(outcome[1]).toBe("LLM_UNAVAILABLE");
    expect(report.outcome_class).toBe("LLM_UNAVAILABLE");
  });

  it("rejects malformed action parameters before execution (INVALID_PARAMS)", async () => {
    const act = vi.fn().mockResolvedValue("ok");
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () =>
        JSON.stringify({ action: "QUARANTINE_RAIL", params: { rail_key: "", injected: "x" }, rationale: "broken rail", confidence: 0.9 }),
      act,
    });
    expect(report.executed).toBe(false);
    expect(report.outcome_class).toBe("INVALID_PARAMS");
    expect(report.action_result).toBe("INVALID_PARAMS");
    expect(act).not.toHaveBeenCalled();
    const kinds = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(["OBSERVATION", "DECISION", "OUTCOME"]);
    const outcome = prismaMock.brainMemory.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { actionResult: string } }).data.actionResult);
    expect(outcome[2]).toBe("INVALID_PARAMS");
  });

  it("skips the cycle (fail-closed) when another holder owns the lease", async () => {
    prismaMock.brainLease.updateMany.mockResolvedValue({ count: 0 });
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "RUN_TICK", params: {}, rationale: "cadence", confidence: 0.8 }),
      act: vi.fn(),
    });
    expect(report.executed).toBe(false);
    expect(report.action_result).toBe("lease_held_elsewhere");
    expect(report.outcome_class).toBe("ACTION_SKIPPED");
    // No memory writes — the skipped cycle leaves no competing records
    expect(prismaMock.brainMemory.create).not.toHaveBeenCalled();
  });

  it("skips the cycle (fail-closed) when the lease store is unreachable", async () => {
    prismaMock.brainLease.updateMany.mockRejectedValue(new Error("db down"));
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "RUN_TICK", params: {}, rationale: "cadence", confidence: 0.8 }),
      act: vi.fn(),
    });
    expect(report.executed).toBe(false);
    expect(report.action_result).toBe("lease_unavailable");
    expect(report.outcome_class).toBe("ACTION_SKIPPED");
    expect(prismaMock.brainMemory.create).not.toHaveBeenCalled();
  });

  it("does not execute an action when the observation audit write fails", async () => {
    prismaMock.brainMemory.create.mockRejectedValueOnce(new Error("audit database unavailable"));
    const act = vi.fn().mockResolvedValue("ok");
    await expect(
      runBrainCycle(new Date(), {
        gather: async () => DATAPOINTS,
        complete: async () => JSON.stringify({ action: "RUN_TICK", params: {}, rationale: "cadence", confidence: 0.8 }),
        act,
      })
    ).rejects.toThrow("audit database unavailable");
    expect(act).not.toHaveBeenCalled();
  });

  it("allows tests to disable the lease via deps.lease = false", async () => {
    prismaMock.brainLease.updateMany.mockRejectedValue(new Error("no lease table in this mock"));
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "RUN_TICK", params: {}, rationale: "cadence", confidence: 0.8 }),
      act: vi.fn().mockResolvedValue("ok"),
      lease: false,
    });
    expect(report.executed).toBe(true);
    expect(prismaMock.brainLease.updateMany).not.toHaveBeenCalled();
  });

  it("includes RUN_RESEARCH_SCAN in the allowlist (bounded internal research)", () => {
    expect(BRAIN_ACTIONS).toContain("RUN_RESEARCH_SCAN");
    expect(BRAIN_ACTIONS).not.toContain("TRANSFER_ANGEL");
  });

  it("treats descriptive ok: action results as successful", async () => {
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "RUN_RESEARCH_SCAN", params: {}, rationale: "scan", confidence: 0.8 }),
      act: vi.fn().mockResolvedValue("ok: findings=2 hypotheses=1 llm_used=true"),
    });
    expect(report.executed).toBe(true);
    expect(report.outcome_class).toBe("ACTION_SUCCEEDED");
    expect(report.action_result).toMatch(/^ok:/);
  });

  it("persists RECORD_NOTE instead of reporting a phantom success", async () => {
    const report = await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "RECORD_NOTE", params: { note: "watch reserve drift" }, rationale: "note", confidence: 0.8 }),
      act: vi.fn(),
    });
    expect(report.executed).toBe(true);
    const note = prismaMock.brainMemory.create.mock.calls
      .map((c: unknown[]) => (c[0] as { data: { kind: string; summary?: string } }).data)
      .find((d: { kind: string }) => d.kind === "NOTE");
    expect(note).toMatchObject({ kind: "NOTE", summary: "watch reserve drift" });
  });

  it("evaluates the previous action against measured health (EVALUATION write)", async () => {
    const T = new Date("2026-09-19T00:00:00Z");
    const history = [
      // Post observation: health improved 0.6 -> 0.9 after the earlier action.
      { id: "o2", cycleId: "c_new", kind: "OBSERVATION", action: null, actionResult: null, healthScore: 0.9, createdAt: new Date(T.getTime() - 10 * 60_000) },
      { id: "k1", cycleId: "c_prev", kind: "OUTCOME", action: "RUN_TICK", actionResult: "ok", healthScore: null, createdAt: new Date(T.getTime() - 20 * 60_000) },
      { id: "o1", cycleId: "c_prev", kind: "OBSERVATION", action: null, actionResult: null, healthScore: 0.6, createdAt: new Date(T.getTime() - 30 * 60_000) },
    ];
    // The playbook read and both attribution reads share this mock; branch on kind.
    prismaMock.brainMemory.findMany.mockImplementation((args: { where?: { kind?: string } }) => {
      if (args?.where?.kind === "EVALUATION") return Promise.resolve([]);
      return Promise.resolve(history);
    });

    await runBrainCycle(new Date(), {
      gather: async () => DATAPOINTS,
      complete: async () => JSON.stringify({ action: "NOOP", params: {}, rationale: "quiet", confidence: 0.9 }),
      act: vi.fn().mockResolvedValue("ok"),
    });

    const evalCall = prismaMock.brainMemory.create.mock.calls
      .map((c: unknown[]) => (c[0] as { data: { kind: string; cycleId?: string; healthScore?: number } }).data)
      .find((d: { kind: string }) => d.kind === "EVALUATION");
    expect(evalCall).toBeDefined();
    expect(evalCall?.cycleId).toBe("c_prev");
    expect(evalCall?.healthScore).toBe(0.9);
  });

  it("summarizePlaybook computes per-action success rates", () => {
    const pb = summarizePlaybook([
      { action: "RUN_TICK", actionResult: "ok" },
      { action: "RUN_RESEARCH_SCAN", actionResult: "ok: findings=2" },
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
