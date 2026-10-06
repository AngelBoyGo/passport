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

const { runMissionDialogue, vetSteps, ALLOWED_ACTIONS, parseConfidenceMarker, parseCritique, extractConfidence } =
  await import("@/lib/brain/dialogue");
const { BRAIN_ACTIONS } = await import("@/lib/brain/command-brain");
const { CONFIDENCE_FLOOR } = await import("@/lib/brain/personas");

describe("dialogue allowlist drift guard", () => {
  it("ALLOWED_ACTIONS is exactly BRAIN_ACTIONS (no silent drift)", () => {
    expect([...ALLOWED_ACTIONS].sort()).toEqual([...BRAIN_ACTIONS].sort());
  });
});

const CTX = { missionId: "msn_1", title: "Earn a first dollar", objective: "Land a paid engagement" };

// Persona JSON helpers — confidence is MANDATORY (missing counts as 0 → rejected).
const draftJson = (confidence = 80, action = "RUN_DISCOVERY") =>
  JSON.stringify({ steps: [{ action, params: {}, rationale: "find demand" }], confidence });
const critiqueProse = (confidence = 75) =>
  `The draft is sound but watch scope. Rank: discovery first. CONFIDENCE: ${confidence}`;

beforeEach(() => {
  completeMock.mockReset();
  delete process.env.LOCAL_LLM_BASE_URL;
});

describe("dialogue — Plan → Critique → Revise → Commit", () => {
  it("runs the three LLM turns and commits a valid plan", async () => {
    completeMock
      .mockResolvedValueOnce(draftJson(80)) // draft (MUSE)
      .mockResolvedValueOnce(critiqueProse(75)) // critique (MARS)
      .mockResolvedValueOnce(draftJson(85)); // revise (MUSE)

    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.turns.map((t) => t.role)).toEqual(["draft", "critique", "revise"]);
    expect(r.steps[0].action).toBe("RUN_DISCOVERY");
    expect(r.committedStep).toBe(1);
  });

  it("drops allowlisted-but-invalid actions via the deterministic arbiter", async () => {
    // SCALE_FLEET_UP with a bad tier must be rejected by param validation.
    completeMock
      .mockResolvedValueOnce(draftJson(80, "SCALE_FLEET_UP"))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85, "SCALE_FLEET_UP"));
    // invalid tier in params
    completeMock.mockReset();
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SCALE_FLEET_UP", params: { capability: "x", llm_tier: "platinum" }, rationale: "bad" }], confidence: 80 }))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SCALE_FLEET_UP", params: { capability: "x", llm_tier: "platinum" }, rationale: "bad" }], confidence: 85 }));

    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_valid_steps_after_vetting");
  });

  it("drops actions not in the allowlist", async () => {
    completeMock
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SEND_ALL_MONEY", params: {}, rationale: "evil" }], confidence: 80 }))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SEND_ALL_MONEY", params: {}, rationale: "evil" }], confidence: 85 }));
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
      .mockResolvedValueOnce(draftJson(80))
      .mockRejectedValueOnce(new Error("mars down"))
      .mockResolvedValueOnce(draftJson(85));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.turns.find((t) => t.role === "critique")?.content).toMatch(/critique_unavailable/);
  });

  it("calls each persona on a distinct model (mars vs muse)", async () => {
    completeMock
      .mockResolvedValueOnce(draftJson(80))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85));
    await runMissionDialogue(CTX);
    const models = completeMock.mock.calls.map((c) => c[0].model);
    expect(models[0]).toBe("openai/gpt-4o-mini"); // MUSE default
    expect(models[1]).toBe("deepseek/deepseek-chat-v3.1"); // MARS default
  });

  it("MORE does NOT join when LOCAL_LLM_BASE_URL is unset (dialogue still completes)", async () => {
    completeMock
      .mockResolvedValueOnce(draftJson(80))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.turns.map((t) => t.role)).toEqual(["draft", "critique", "revise"]);
    expect(completeMock).toHaveBeenCalledTimes(3);
  });

  it("MORE joins when configured and can REPLACE the plan with a synthesis", async () => {
    process.env.LOCAL_LLM_BASE_URL = "http://100.64.0.5:11434/v1";
    completeMock
      .mockResolvedValueOnce(draftJson(80)) // muse draft
      .mockResolvedValueOnce(critiqueProse(75)) // mars
      .mockResolvedValueOnce(draftJson(85)) // muse revise
      .mockResolvedValueOnce(
        JSON.stringify({
          steps: [{ action: "RUN_EXTERNAL_RESEARCH", params: { focus: "adoption channels" }, rationale: "synthesized" }],
          confidence: 90,
          synthesis: "replaced with demand-first research",
        })
      ); // more (local gemma-4)
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    const roles = r.turns.map((t) => t.role);
    expect(roles).toContain("synthesize");
    expect(roles[roles.length - 1]).toBe("synthesize");
    expect(r.steps[0].action).toBe("RUN_EXTERNAL_RESEARCH");
    // MORE ran on the local tier + its model, with its own temperature
    const last = completeMock.mock.calls[3][0];
    expect(last.tier).toBe("local");
    expect(last.model).toBe("gemma4-31b-heretic-64k".slice(0, 0) + "gemma-4"); // allowlist default
    delete process.env.LOCAL_LLM_BASE_URL;
  });

  it("a MORE failure degrades gracefully (keeps MUSE's plan)", async () => {
    process.env.LOCAL_LLM_BASE_URL = "http://100.64.0.5:11434/v1";
    completeMock
      .mockResolvedValueOnce(draftJson(80))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85))
      .mockRejectedValueOnce(new Error("tailscale down"));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.steps[0].action).toBe("RUN_DISCOVERY");
    expect(r.turns[r.turns.length - 1].content).toMatch(/more_unavailable/);
    delete process.env.LOCAL_LLM_BASE_URL;
  });
});

describe("confidence system (owner-directed 51% floor)", () => {
  it("REJECTS a draft below the floor and commits nothing", async () => {
    completeMock.mockResolvedValueOnce(draftJson(49));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(`low_confidence_draft:49`);
    expect(r.summary).toMatch(/rejected at confidence 49/);
  });

  it("REJECTS a draft with a MISSING confidence (counts as 0)", async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "RUN_DISCOVERY", params: {}, rationale: "x" }] }));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("low_confidence_draft:0");
  });

  it("critique sees the draft's confidence (cross-visibility)", async () => {
    completeMock
      .mockResolvedValueOnce(draftJson(80))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85));
    await runMissionDialogue(CTX);
    const critiqueCall = completeMock.mock.calls[1][0];
    expect(critiqueCall.user).toMatch(/muse_confidence=80/);
    // the revise turn sees both confidences
    const reviseCall = completeMock.mock.calls[2][0];
    expect(reviseCall.user).toMatch(/your_draft_confidence=80/);
    expect(reviseCall.user).toMatch(/mars_confidence=75/);
  });

  it("a low-confidence REVISE is ignored (the draft is kept)", async () => {
    completeMock
      .mockResolvedValueOnce(draftJson(80, "RUN_DISCOVERY"))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(30, "RUN_TICK")); // revise below floor
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.steps[0].action).toBe("RUN_DISCOVERY"); // draft kept, not RUN_TICK
    const reviseTurn = r.turns.find((t) => t.role === "revise");
    expect(reviseTurn?.content).toMatch(/kept_draft_confidence_30/);
  });

  it("a low-confidence MORE synthesis is ignored (revised plan kept)", async () => {
    process.env.LOCAL_LLM_BASE_URL = "http://100.64.0.5:11434/v1";
    completeMock
      .mockResolvedValueOnce(draftJson(80, "RUN_DISCOVERY"))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85, "RUN_TICK"))
      .mockResolvedValueOnce(JSON.stringify({ steps: [{ action: "SEND_ALL_MONEY", params: {}, rationale: "wild" }], confidence: 20, synthesis: "wild idea" }));
    const r = await runMissionDialogue(CTX);
    expect(r.ok).toBe(true);
    expect(r.steps[0].action).toBe("RUN_TICK"); // revise kept, not the low-conf synthesis
    delete process.env.LOCAL_LLM_BASE_URL;
  });

  it("steps carry their producing turn's confidence into the committed plan", async () => {
    completeMock
      .mockResolvedValueOnce(draftJson(80))
      .mockResolvedValueOnce(critiqueProse(75))
      .mockResolvedValueOnce(draftJson(85));
    const r = await runMissionDialogue(CTX);
    expect(r.steps[0].confidence).toBe(85);
  });

  it("extractConfidence clamps to 0-100", () => {
    expect(extractConfidence({ confidence: 150 })).toBe(100);
    expect(extractConfidence({ confidence: -5 })).toBe(0);
    expect(extractConfidence({ confidence: "62" })).toBe(62);
    expect(extractConfidence({})).toBe(0);
  });
});

describe("parseConfidenceMarker (MARS prose)", () => {
  it("parses a trailing marker and strips it from the text", () => {
    const { text, confidence } = parseConfidenceMarker("Good plan, watch risk. CONFIDENCE: 72");
    expect(text).toBe("Good plan, watch risk.");
    expect(confidence).toBe(72);
  });
  it("tolerates a % sign and case-insensitivity", () => {
    const { confidence } = parseConfidenceMarker("ok. confidence: 88%");
    expect(confidence).toBe(88);
  });
  it("returns null when no marker is present (advisory, not a gate)", () => {
    const { text, confidence } = parseConfidenceMarker("No marker here.");
    expect(text).toBe("No marker here.");
    expect(confidence).toBeNull();
  });
});

describe("parseCritique (accepts marker OR JSON body)", () => {
  it("parses a fenced JSON critique with a confidence field (MARS's actual shape)", () => {
    const raw =
      '```json\n{"confidence": 85, "critique": "DISCOVERY is best.", "ranking": ["RUN_DISCOVERY"]}\n```';
    const { text, confidence } = parseCritique(raw);
    expect(confidence).toBe(85);
    expect(text).toBe("DISCOVERY is best.");
  });
  it("still parses a plain trailing marker", () => {
    const { text, confidence } = parseCritique("Watch cost. CONFIDENCE: 60");
    expect(confidence).toBe(60);
    expect(text).toBe("Watch cost.");
  });
  it("falls back to the raw text with null confidence on unparseable prose", () => {
    const { text, confidence } = parseCritique("just some prose");
    expect(text).toBe("just some prose");
    expect(confidence).toBeNull();
  });
});

describe("vetSteps (deterministic arbiter)", () => {
  it("keeps only valid, allowlisted, confident steps and renumbers", () => {
    const out = vetSteps([
      { step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "a", done: false, confidence: 80 },
      { step: 2, action: "NOT_REAL", params: {}, rationale: "b", done: false, confidence: 80 },
      { step: 3, action: "RUN_LOCUM_SEARCH", params: { candidate_id: "c1" }, rationale: "c", done: false, confidence: 62 },
    ]);
    expect(out.map((s) => s.action)).toEqual(["RUN_DISCOVERY", "RUN_LOCUM_SEARCH"]);
    expect(out.map((s) => s.step)).toEqual([1, 2]);
  });

  it("rejects steps below the confidence floor (missing = 0)", () => {
    const out = vetSteps([
      { step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "a", done: false, confidence: 50 },
      { step: 2, action: "RUN_TICK", params: {}, rationale: "b", done: false, confidence: undefined },
    ]);
    expect(out).toHaveLength(0);
  });

  it("rejects NaN / non-numeric confidence (F5: must not fail OPEN)", () => {
    const out = vetSteps([
      { step: 1, action: "RUN_DISCOVERY", params: {}, rationale: "a", done: false, confidence: NaN },
      { step: 2, action: "RUN_TICK", params: {}, rationale: "b", done: false, confidence: "abc" as unknown as number },
    ]);
    expect(out).toHaveLength(0);
  });

  it("rejects ADVANCE_MISSION_PLAN as a stored step (it is a meta-action)", () => {
    const out = vetSteps([{ step: 1, action: "ADVANCE_MISSION_PLAN", params: { mission_id: "m1" }, rationale: "x", done: false, confidence: 90 }]);
    expect(out).toHaveLength(0);
  });
});
