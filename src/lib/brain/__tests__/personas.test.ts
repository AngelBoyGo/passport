import { describe, expect, it } from "vitest";
import { PERSONAS, DRAFTER, CRITIC, personaModel, PERSONA_TIER } from "../personas";
import { TIER_MODEL_ALLOWLIST } from "@/lib/llm/tiers";

describe("brain personas", () => {
  it("has exactly MARS, MUSE and MORE", () => {
    expect(Object.keys(PERSONAS).sort()).toEqual(["mars", "more", "muse"]);
  });

  it("uses DISTINCT models for mars and muse on the cortex tier", () => {
    expect(PERSONAS.mars.defaultModel).not.toBe(PERSONAS.muse.defaultModel);
    expect(PERSONAS.mars.tier).toBe("cortex");
    expect(PERSONAS.muse.tier).toBe("cortex");
  });

  it("MORE runs on the LOCAL tier (self-hosted), never money", () => {
    expect(PERSONAS.more.tier).toBe("local");
    expect(PERSONAS.more.tier).not.toBe("money");
    expect(PERSONAS.more.defaultModel).toBe("gemma-4");
  });

  it("all persona models are allowlisted on their own tier", () => {
    for (const p of Object.values(PERSONAS)) {
      expect(TIER_MODEL_ALLOWLIST[p.tier]).toContain(p.defaultModel);
    }
  });

  it("MARS is colder (calculating) than MUSE (creative)", () => {
    expect(PERSONAS.mars.temperature).toBeLessThan(PERSONAS.muse.temperature);
    expect(PERSONAS.mars.temperature).toBeLessThanOrEqual(0.2);
    expect(PERSONAS.muse.temperature).toBeGreaterThanOrEqual(0.7);
  });

  it("all system prompts bind to the action allowlist and forbid moving money", () => {
    for (const p of Object.values(PERSONAS)) {
      expect(p.systemPrompt).toMatch(/STRICT JSON/);
      expect(p.systemPrompt).toMatch(/never move money|never-move-money|NEVER move money/);
      expect(p.systemPrompt).toContain("ADVANCE_MISSION_PLAN");
    }
  });

  it("personaModel honours an env override", () => {
    expect(personaModel(PERSONAS.muse, { LLM_MODEL_MUSE: "deepseek/deepseek-chat-v3.1" })).toBe("deepseek/deepseek-chat-v3.1");
    expect(personaModel(PERSONAS.more, { LLM_MODEL_MORE: "gemma-3" })).toBe("gemma-3");
    expect(personaModel(PERSONAS.muse, {})).toBe(PERSONAS.muse.defaultModel);
  });

  it("drafter is MUSE, critic is MARS", () => {
    expect(DRAFTER).toBe("muse");
    expect(CRITIC).toBe("mars");
  });
});
