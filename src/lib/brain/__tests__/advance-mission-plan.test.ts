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

  it("surfaces an inner failure returned as a string (does NOT mask it as ok)", async () => {
    // RUN_LOCUM_SEARCH returns "error: <reason>" (a string, not a throw) when
    // the capability is disabled. The wrapper must NOT report success or mark
    // the step done — this was the masking bug.
    getCurrentPlanMock.mockResolvedValue({
      planId: "plan_1",
      missionId: "msn_1",
      steps: [{ step: 1, action: "RUN_LOCUM_SEARCH", params: { candidate_id: "c1" }, rationale: "x", done: false }],
    });
    const out = await defaultAct("ADVANCE_MISSION_PLAN" as never, { mission_id: "msn_1" });
    // The locum capability is not configured in the test env, so the inner
    // action returns an error string. Assert it is surfaced (not masked).
    expect(out).toMatch(/^error: step_failed:/);
    expect(markStepDoneMock).not.toHaveBeenCalled();
  });
});
