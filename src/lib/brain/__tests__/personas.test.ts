import { describe, expect, it } from "vitest";
import { PERSONAS, DRAFTER, CRITIC, personaModel, PERSONA_TIER } from "../personas";
import { TIER_MODEL_ALLOWLIST } from "@/lib/llm/tiers";

describe("brain personas", () => {
  it("has exactly MARS and MUSE", () => {
    expect(Object.keys(PERSONAS).sort()).toEqual(["mars", "muse"]);
  });

  it("uses DISTINCT models on the cortex tier", () => {
    expect(PERSONAS.mars.defaultModel).not.toBe(PERSONAS.muse.defaultModel);
  });

  it("both persona models are allowlisted on the cortex tier", () => {
    for (const p of Object.values(PERSONAS)) {
      expect(TIER_MODEL_ALLOWLIST[PERSONA_TIER]).toContain(p.defaultModel);
    }
  });

  it("MARS is colder (calculating) than MUSE (creative)", () => {
    expect(PERSONAS.mars.temperature).toBeLessThan(PERSONAS.muse.temperature);
    expect(PERSONAS.mars.temperature).toBeLessThanOrEqual(0.2);
    expect(PERSONAS.muse.temperature).toBeGreaterThanOrEqual(0.7);
  });

  it("both system prompts bind to the action allowlist and forbid moving money", () => {
    for (const p of Object.values(PERSONAS)) {
      expect(p.systemPrompt).toMatch(/STRICT JSON/);
      expect(p.systemPrompt).toMatch(/NEVER move money/);
      expect(p.systemPrompt).toContain("ADVANCE_MISSION_PLAN");
    }
  });

  it("personaModel honours an env override", () => {
    expect(personaModel(PERSONAS.muse, { LLM_MODEL_MUSE: "gemini-1.5-flash" })).toBe("gemini-1.5-flash");
    expect(personaModel(PERSONAS.muse, {})).toBe(PERSONAS.muse.defaultModel);
  });

  it("drafter is MUSE, critic is MARS", () => {
    expect(DRAFTER).toBe("muse");
    expect(CRITIC).toBe("mars");
  });
});
