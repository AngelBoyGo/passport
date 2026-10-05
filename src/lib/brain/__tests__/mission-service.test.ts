import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    mission: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    missionPlan: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { createMission, setMissionStatus, maxActiveMissions, commitPlan } = await import(
  "@/lib/brain/mission-service"
);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
});

const missionRow = {
  missionId: "msn_1",
  title: "T",
  objective: "O",
  thesis: null,
  status: "ACTIVE",
  priority: 50,
  originPersona: "mars",
  keyResults: null,
};

describe("mission-service — creation", () => {
  it("creates a mission when under the cap", async () => {
    prismaMock.mission.count.mockResolvedValue(0);
    prismaMock.mission.findFirst.mockResolvedValue(null);
    prismaMock.mission.create.mockResolvedValue(missionRow);
    const r = await createMission({ title: "T", objective: "O" });
    expect(r.ok).toBe(true);
  });

  it("refuses at the active cap (fail-closed)", async () => {
    prismaMock.mission.count.mockResolvedValue(maxActiveMissions());
    const r = await createMission({ title: "T", objective: "O" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cap_reached/);
    expect(prismaMock.mission.create).not.toHaveBeenCalled();
  });

  it("dedupes on an existing active title", async () => {
    prismaMock.mission.count.mockResolvedValue(0);
    prismaMock.mission.findFirst.mockResolvedValue({ missionId: "msn_dup" });
    const r = await createMission({ title: "T", objective: "O" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/duplicate_mission/);
  });
});

describe("mission-service — status lifecycle", () => {
  it("allows ACTIVE → PAUSED", async () => {
    prismaMock.mission.findUnique.mockResolvedValue({ ...missionRow, status: "ACTIVE" });
    prismaMock.mission.update.mockResolvedValue({});
    const r = await setMissionStatus("msn_1", "PAUSED");
    expect(r.ok).toBe(true);
  });

  it("rejects ACHIEVED → ACTIVE (terminal)", async () => {
    prismaMock.mission.findUnique.mockResolvedValue({ ...missionRow, status: "ACHIEVED" });
    const r = await setMissionStatus("msn_1", "ACTIVE");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/illegal_mission_transition/);
  });
});

describe("mission-service — commitPlan", () => {
  it("supersedes the prior plan and points the mission at the new one", async () => {
    prismaMock.mission.findUnique.mockResolvedValue(missionRow);
    prismaMock.missionPlan.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.missionPlan.create.mockResolvedValue({});
    prismaMock.mission.update.mockResolvedValue({});
    const r = await commitPlan({
      missionId: "msn_1",
      steps: [{ step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "x", done: false }],
      createdByPersona: "muse",
    });
    expect(r.ok).toBe(true);
    expect(prismaMock.missionPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "COMMITTED" }) })
    );
  });

  it("refuses a plan for an unknown mission", async () => {
    prismaMock.mission.findUnique.mockResolvedValue(null);
    const r = await commitPlan({ missionId: "nope", steps: [] });
    expect(r.ok).toBe(false);
  });

  it("carries step confidence through the plan round-trip (F3)", async () => {
    prismaMock.mission.findUnique.mockResolvedValue(missionRow);
    prismaMock.missionPlan.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.missionPlan.create.mockResolvedValue({});
    prismaMock.mission.update.mockResolvedValue({});
    const r = await commitPlan({
      missionId: "msn_1",
      steps: [{ step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "x", done: false, confidence: 77 }],
      createdByPersona: "muse",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.steps[0].confidence).toBe(77);
  });
});
