import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    brainMemory: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    improvementProposal: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    replayRun: { create: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { scoreReplay, type ReplayCycleOutcome } from "../replay";
import { createProposal, transitionProposal, replayAndScore } from "../proposal-service";

function cycleOutcome(partial: Partial<ReplayCycleOutcome>): ReplayCycleOutcome {
  return {
    cycleId: "c1",
    actual: "RUN_TICK",
    candidate: "RUN_TICK",
    match: true,
    contribution: 1,
    outcomeClass: "UNKNOWN",
    ...partial,
  };
}

describe("scoreReplay", () => {
  it("scores all-match history as NEUTRAL with a strong score", () => {
    const s = scoreReplay([cycleOutcome({}), cycleOutcome({ cycleId: "c2" })]);
    expect(s.verdict).toBe("NEUTRAL");
    expect(s.decisionMatches).toBe(2);
    expect(s.score).toBe(1);
  });

  it("scores avoided negatives as IMPROVE", () => {
    const s = scoreReplay([
      cycleOutcome({ match: false, outcomeClass: "NEGATIVE", candidate: "NOOP", actual: "RUN_TICK", contribution: 1 }),
      cycleOutcome({ cycleId: "c2" }),
    ]);
    expect(s.negativeAvoided).toBe(1);
    expect(s.verdict).toBe("IMPROVE");
  });

  it("scores displaced positives as REGRESS", () => {
    const s = scoreReplay([
      cycleOutcome({ match: false, outcomeClass: "POSITIVE", candidate: "NOOP", actual: "RUN_TICK", contribution: -1 }),
      cycleOutcome({ cycleId: "c2" }),
    ]);
    expect(s.positiveDisplaced).toBe(1);
    expect(s.verdict).toBe("REGRESS");
    expect(s.score).toBeLessThan(1);
  });

  it("treats unknown diffs as mild risk, never as proof", () => {
    const s = scoreReplay([
      cycleOutcome({ match: false, outcomeClass: "UNKNOWN", candidate: "NOOP", actual: "RUN_TICK", contribution: 0.3 }),
      cycleOutcome({ cycleId: "c2" }),
    ]);
    expect(s.unknownDiffs).toBe(1);
    expect(s.verdict).toBe("NEUTRAL");
  });

  it("handles empty history honestly (NEUTRAL, no fabricated evidence)", () => {
    const s = scoreReplay([]);
    expect(s.cyclesCompared).toBe(0);
    expect(s.verdict).toBe("NEUTRAL");
  });
});

describe("proposal state machine", () => {
  const proposal = {
    id: "row1",
    proposalId: "prop_1",
    objective: "obj",
    expectedImprovement: "imp",
    riskClass: "low",
    status: "PROPOSED",
    sourceScanId: null,
    params: {},
    replayId: null,
    replayScore: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.improvementProposal.findFirst.mockResolvedValue(null);
    prismaMock.improvementProposal.findUnique.mockResolvedValue(proposal);
    prismaMock.improvementProposal.create.mockResolvedValue(proposal);
    prismaMock.improvementProposal.update.mockImplementation(async (args: { where: { proposalId: string }; data: { status: string } }) => ({
      ...proposal,
      status: args.data.status,
    }));
    prismaMock.brainMemory.findMany.mockResolvedValue([]);
    prismaMock.brainMemory.findFirst.mockResolvedValue(null);
    prismaMock.replayRun.create.mockResolvedValue({});
  });

  it("dedupes proposals on identical open objectives", async () => {
    prismaMock.improvementProposal.findFirst.mockResolvedValueOnce({ proposalId: "prop_existing" });
    const r = await createProposal({ objective: "obj", expectedImprovement: "imp" });
    expect(r).toEqual({ proposalId: "prop_existing", deduped: true });
    expect(prismaMock.improvementProposal.create).not.toHaveBeenCalled();
  });

  it("rejects illegal transitions", async () => {
    await expect(transitionProposal("prop_1", "promote", "op_1")).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("blocks a second canary while one is active", async () => {
    prismaMock.improvementProposal.findUnique.mockResolvedValue({ ...proposal, status: "APPROVED" });
    prismaMock.improvementProposal.findFirst.mockResolvedValueOnce({ proposalId: "prop_other" });
    await expect(transitionProposal("prop_1", "canary", "op_1")).rejects.toMatchObject({
      code: "canary_conflict",
    });
  });

  it("runs the full legal path: replay -> audited -> approval -> approved -> canary -> promoted", async () => {
    // Replay: history is empty -> NEUTRAL -> REPLAYED
    const r = await replayAndScore("prop_1", 7);
    expect(r.to).toBe("REPLAYED");
    expect(prismaMock.replayRun.create).toHaveBeenCalled();

    const steps: Array<[Parameters<typeof transitionProposal>[1], string]> = [
      ["mark_audited", "REPLAYED"],
      ["require_approval", "AUDITED"],
      ["approve", "APPROVAL_REQUIRED"],
      ["canary", "APPROVED"],
      ["promote", "CANARY"],
    ];
    let current = "REPLAYED";
    for (const [action, from] of steps) {
      prismaMock.improvementProposal.findUnique.mockResolvedValueOnce({ ...proposal, status: from });
      const t = await transitionProposal("prop_1", action, "op_1");
      expect(t.from).toBe(current);
      current = t.to;
    }
    expect(current).toBe("PROMOTED");
  });

  it("auto-rejects on a REGRESS replay verdict", async () => {
    // History where the actual action was POSITIVE-attributed but the candidate differs.
    const rows = [
      {
        id: "o2",
        cycleId: "c2",
        kind: "OBSERVATION",
        action: null,
        actionResult: null,
        healthScore: 0.9,
        createdAt: new Date(),
        data: { integrity: { ok: true, issues: [] }, rails: { enabled: 1, quarantined: 0 }, disputes_open: 0 },
      },
      {
        id: "k1",
        cycleId: "c1",
        kind: "EVALUATION",
        action: "RUN_TICK",
        actionResult: "ok",
        healthScore: 0.9,
        createdAt: new Date(),
        data: { action: "RUN_TICK", delta: 0.3, result: "POSITIVE", confidence: 1, confounders: [] },
      },
      {
        id: "o1",
        cycleId: "c1",
        kind: "OBSERVATION",
        action: null,
        actionResult: null,
        healthScore: 0.6,
        createdAt: new Date(),
        data: { integrity: { ok: true, issues: [] }, rails: { enabled: 1, quarantined: 0 }, disputes_open: 0 },
      },
      // A decision row for c1 (the actual action) that the candidate disagrees with:
      {
        id: "d1",
        cycleId: "c1",
        kind: "DECISION",
        action: "RUN_TICK",
        actionResult: null,
        healthScore: null,
        createdAt: new Date(),
        data: {},
      },
    ];

    // Make an integrity-issue cycle the candidate disagrees with: candidate says NOOP,
    // actual was RUN_TICK which was POSITIVE-attributed -> positiveDisplaced -> REGRESS.
    const decisionRow = rows.find((r) => r.kind === "DECISION")!;
    prismaMock.brainMemory.findMany.mockImplementation((args: { where?: { kind?: string } }) => {
      const kind = args?.where?.kind;
      if (kind === "OBSERVATION") return Promise.resolve([rows[0], rows[2]]);
      if (kind === "DECISION") return Promise.resolve([decisionRow]);
      if (kind === "EVALUATION") return Promise.resolve([rows[1]]);
      return Promise.resolve([]);
    });
    // Candidate policy that would NOOP on an integrity-issue cycle: max attestation threshold.
    prismaMock.improvementProposal.findUnique.mockResolvedValue({
      ...proposal,
      status: "PROPOSED",
      params: { minIntegrityIssuesForAttestation: 10 },
    });

    const r = await replayAndScore("prop_1", 7);
    expect(r.replay.verdict).toBe("REGRESS");
    expect(r.to).toBe("REJECTED");
  });
});