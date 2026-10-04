import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentPlanMock, markStepDoneMock, runDiscoveryMock } = vi.hoisted(() => ({
  getCurrentPlanMock: vi.fn(),
  markStepDoneMock: vi.fn(),
  runDiscoveryMock: vi.fn(),
}));

vi.mock("@/lib/brain/mission-service", () => ({
  getCurrentPlan: getCurrentPlanMock,
  markStepDone: markStepDoneMock,
}));
vi.mock("@/lib/raillab/discovery", () => ({ runDiscovery: runDiscoveryMock }));
vi.mock("@/lib/db", () => ({ prisma: { railSpec: { findUnique: vi.fn() } } }));

const { defaultAct } = await import("@/lib/brain/command-brain");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defaultAct — ADVANCE_MISSION_PLAN dispatches to the step's real action", () => {
  it("executes the next open step (RUN_DISCOVERY) and marks it done on success", async () => {
    getCurrentPlanMock.mockResolvedValue({
      planId: "plan_1",
      missionId: "msn_1",
      steps: [{ step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "x", done: false }],
    });
    runDiscoveryMock.mockResolvedValue(undefined);
    const out = await defaultAct("ADVANCE_MISSION_PLAN" as never, { mission_id: "msn_1" });
    expect(out).toMatch(/ok: mission=msn_1 step=1 action=RUN_DISCOVERY/);
    expect(runDiscoveryMock).toHaveBeenCalledTimes(1);
    expect(markStepDoneMock).toHaveBeenCalledWith("plan_1", 1);
  });

  it("does NOT mark done when the sub-action fails", async () => {
    getCurrentPlanMock.mockResolvedValue({
      planId: "plan_1",
      missionId: "msn_1",
      steps: [{ step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "x", done: false }],
    });
    runDiscoveryMock.mockRejectedValue(new Error("boom"));
    // A sub-action failure propagates; the cycle's outer try/catch converts it
    // to ACTION_FAILED. The key guarantee: the step is NOT marked done.
    await expect(
      defaultAct("ADVANCE_MISSION_PLAN" as never, { mission_id: "msn_1" })
    ).rejects.toThrow("boom");
    expect(markStepDoneMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no committed plan", async () => {
    getCurrentPlanMock.mockResolvedValue(null);
    const out = await defaultAct("ADVANCE_MISSION_PLAN" as never, { mission_id: "msn_x" });
    expect(out).toBe("error: no_committed_plan");
  });

  it("refuses a recursive ADVANCE_MISSION_PLAN step", async () => {
    getCurrentPlanMock.mockResolvedValue({
      planId: "plan_1",
      missionId: "msn_1",
      steps: [{ step: 1, action: "ADVANCE_MISSION_PLAN", params: { mission_id: "m" }, rationale: "x", done: false }],
    });
    const out = await defaultAct("ADVANCE_MISSION_PLAN" as never, { mission_id: "msn_1" });
    expect(out).toBe("error: recursive_mission_step");
  });
});
