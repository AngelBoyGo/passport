import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, completeMock, gatherMock, listMissionsMock, getPlanMock, createMissionMock, moltbookMock } =
  vi.hoisted(() => ({
    prismaMock: {
      brainMemory: { findMany: vi.fn() },
      adminAuditLog: { create: vi.fn(), findMany: vi.fn() },
    },
    completeMock: vi.fn(),
    gatherMock: vi.fn(),
    listMissionsMock: vi.fn(),
    getPlanMock: vi.fn(),
    createMissionMock: vi.fn(),
    moltbookMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/raillab/factory-brain", () => ({ brainComplete: completeMock }));
vi.mock("@/lib/brain/command-brain", () => ({ gatherDatapoints: gatherMock }));
vi.mock("@/lib/brain/mission-service", () => ({
  listActiveMissions: listMissionsMock,
  getCurrentPlan: getPlanMock,
  createMission: createMissionMock,
}));
vi.mock("@/lib/brain/moltbook", () => ({ recentMoltbookItems: moltbookMock }));

const { askBrain, assignTask, gatherBrainResources, askPersona } = await import("@/lib/brain/ask");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.brainMemory.findMany.mockResolvedValue([]);
  prismaMock.adminAuditLog.create.mockResolvedValue({});
  gatherMock.mockResolvedValue({ economy: {}, health_score: 1 });
  listMissionsMock.mockResolvedValue([]);
  moltbookMock.mockResolvedValue([]);
});

describe("askBrain", () => {
  it("answers using live resources", async () => {
    completeMock.mockResolvedValue("The economy is idle; I would run discovery first.");
    const r = await askBrain("what would you do next?");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.answer).toMatch(/discovery/);
    expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "brain_ask" }) })
    );
  });

  it("rejects an empty question", async () => {
    const r = await askBrain("   ");
    expect(r.ok).toBe(false);
  });

  it("fails closed when the model errors", async () => {
    completeMock.mockRejectedValue(new Error("gateway down"));
    const r = await askBrain("hello?");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/gateway down/);
  });
});

describe("assignTask", () => {
  it("creates an OPERATOR-authored top-priority mission", async () => {
    createMissionMock.mockResolvedValue({
      ok: true,
      mission: { missionId: "msn_op", title: "Find a buyer" },
    });
    const alla = await assignTask("Find a buyer for the first commodity lot");
    expect(alla.ok).toBe(true);
    if (alla.ok) expect(alla.missionId).toBe("msn_op");
    expect(createMissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "operator", priority: 95 })
    );
  });

  it("surfaces the active-mission cap instead of dropping the task", async () => {
    createMissionMock.mockResolvedValue({ ok: false, reason: "active_mission_cap_reached:5/5" });
    const r = await assignTask("Do something");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cap_reached/);
  });

  it("rejects an empty instruction", async () => {
    const r = await assignTask("  ");
    expect(r.ok).toBe(false);
  });
});

describe("gatherBrainResources", () => {
  it("bundles datapoints, missions, moltbook, and memory", async () => {
    listMissionsMock.mockResolvedValue([{ missionId: "msn_1", title: "M", objective: "O", status: "ACTIVE" }]);
    getPlanMock.mockResolvedValue({ steps: [{ step: 1, action: "RUN_DISCOVERY", rationale: "x", done: false }] });
    moltbookMock.mockResolvedValue([
      { title: "T", body: "B", author: "a", injectionScan: { safe: true, matched: [] } },
    ]);
    prismaMock.brainMemory.findMany.mockResolvedValue([{ kind: "DECISION", summary: "s" }]);
    const bundle = await gatherBrainResources();
    expect(bundle.missions[0].nextStep).toMatch(/RUN_DISCOVERY/);
    expect(bundle.moltbook[0].title).toBe("T");
    expect(bundle.recentMemory[0].kind).toBe("DECISION");
  });
});

describe("askPersona", () => {
  it("MARS answers in its own voice and is audit-logged as brain_ask_mars", async () => {
    completeMock.mockResolvedValue("Attack the weakest assumption first.");
    const r = await askPersona("mars", "what should we do?");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.persona).toBe("MARS");
    expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "brain_ask_mars" }) })
    );
  });

  it("MUSE is audit-logged as brain_ask_muse", async () => {
    completeMock.mockResolvedValue("Let's try something nobody has tried.");
    await askPersona("muse", "any wild ideas?");
    expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "brain_ask_muse" }) })
    );
  });

  it("rejects an empty question", async () => {
    const r = await askPersona("mars", "  ");
    expect(r.ok).toBe(false);
  });
});
