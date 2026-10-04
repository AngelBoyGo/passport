import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/raillab/factory-brain", () => ({
  brainComplete: completeMock,
  // real parseJsonObject behavior (strip fences, require object)
  parseJsonObject: (text: string) => {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  },
}));

const { runMissionDialogue, vetSteps, ALLOWED_ACTIONS } = await import("@/lib/brain/dialogue");
const { BRAIN_ACTIONS } = await import("@/lib/brain/command-brain");

describe("dialogue allowlist drift guard", () => {
  it("ALLOWED_ACTIONS is exactly BRAIN_ACTIONS (no silent drift)", () => {
    expect([...ALLOWED_ACTIONS].sort()).toEqual([...BRAIN_ACTIONS].sort());
  });
});

const CTX = { missionId: "msn_1", title: "Earn a first dollar", objective: "Land a paid engagement" };

beforeEach(() => {
  completeMock.mockReset();
});

describe("dialogue — Plan → Critique → Revise → Commit", () => {
  it("runs the three LLM turns and commits a valid plan", async () => {
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "find demand" }] })) // draft (MUSE)
      .mockResolvedValueOnce(JSON.stringify({ ranking: ["weak demand"], notes: "do discovery first" })) // critique (MARS)
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "confirmed" }] })); // revise (MUSE)

    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.turns.map((t) => t.role)).toEqual(["draft", "critique", "revise"]);
    expect(r.steps[0].action).toBe("RUN_DISCOVERY");
    expect(r.committedStep).toBe(1);
  });

  it("drops allowlisted-but-invalid actions via the deterministic arbiter", async () => {
    // SCALE_FLEET_UP with a bad tier must be rejected by param validation.
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SCALE_FLEET_UP", params: { capability: "x", llm_tier: "platinum" }, rationale: "bad" }] }))
      .mockResolvedValueOnce(JSON.stringify({ ranking: [] }))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SCALE_FLEET_UP", params: { capability: "x", llm_tier: "platinum" }, rationale: "bad" }] }));

    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_valid_steps_after_vetting");
  });

  it("drops actions not in the allowlist", async () => {
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SEND_ALL_MONEY", params: {}, rationale: "evil" }] }))
      .mockResolvedValueOnce(JSON.stringify({ ranking: [] }))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SEND_ALL_MONEY", params: {}, rationale: "evil" }] }));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(false);
  });

  it("fails closed when the draft call throws", async () => {
    completeMock.mockRejectedValueOnce(new Error("gateway 500"));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/draft_failed/);
    expect(r.steps).toEqual([]);
  });

  it("continues when the critique call fails (arbiter still vets draft)", async () => {
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "d" }] }))
      .mockRejectedValueOnce(new Error("mars down"))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "d" }] }));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.turns.find((t) => t.role === "critique")?.content).toMatch(/critique_unavailable/);
  });

  it("calls each persona on a distinct model (mars vs muse)", async () => {
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "d" }] }))
      .mockResolvedValueOnce(JSON.stringify({ ranking: [] }))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "d" }] }));
    await runMissionDialogue(CTX);
    const models = completeMock.mock.calls.map((c) => c[0].model);
    expect(models[0]).toBe("gpt-4o-mini"); // MUSE default
    expect(models[1]).toBe("deepseek-v4-flash"); // MARS default
  });
});

describe("vetSteps (deterministic arbiter)", () => {
  it("keeps only valid, allowlisted steps and renumbers", () => {
    const out = vetSteps([
      { step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "a", done: false },
      { step: 2, action: "NOT_REAL", params: {}, rationale: "b", done: false },
      { step: 3, action: "RUN_LOCUM_SEARCH", params: { candidate_id: "c1" }, rationale: "c", done: false },
    ]);
    expect(out.map((s) => s.action)).toEqual(["RUN_DISCOVERY", "RUN_LOCUM_SEARCH"]);
    expect(out.map((s) => s.step)).toEqual([1, 2]);
  });

  it("rejects ADVANCE_MISSION_PLAN as a stored step (it is a meta-action)", () => {
    // A plan step must be real work; ADVANCE_MISSION_PLAN is how the cycle runs
    // a stored step, so it can never itself be stored.
    const out = vetSteps([{ step: 1, action: "ADVANCE_MISSION_PLAN", params: { mission_id: "m1" }, rationale: "x", done: false }]);
    expect(out).toHaveLength(0);
  });
});
