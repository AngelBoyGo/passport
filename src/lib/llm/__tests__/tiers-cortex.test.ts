import { describe, expect, it, afterEach } from "vitest";
import {
  LLM_TIERS,
  TIER_MODEL_ALLOWLIST,
  DEFAULT_TIER_MODEL,
  resolveTierModel,
  resolveAllowlistedModel,
  isLlmTier,
  tierSatisfies,
  tierAllowlist,
  rankOf,
} from "../tiers";

afterEach(() => {
  delete process.env.LOCAL_MODEL_ALLOWLIST;
  delete process.env.LLM_MODEL_ALLOWLIST_CORTEX;
  delete process.env.LLM_MODEL_ALLOWLIST_NEURON;
});

describe("llm tiers — cortex expansion", () => {
  it("has the 4 tiers: local, cortex, neuron, money", () => {
    expect(LLM_TIERS).toEqual(["local", "cortex", "neuron", "money"]);
  });

  it("cortex admits only cheap, allowlisted models", () => {
    expect(TIER_MODEL_ALLOWLIST.cortex).toContain("z-ai/glm-5.3-flash");
    expect(TIER_MODEL_ALLOWLIST.cortex).toContain("deepseek/deepseek-chat-v3.1");
    // money-tier model is never admitted on cortex
    expect(TIER_MODEL_ALLOWLIST.cortex).not.toContain("deepseek/deepseek-r1");
  });

  it("money tier admits only the pinned strongest model", () => {
    expect(TIER_MODEL_ALLOWLIST.money).toEqual(["deepseek/deepseek-r1"]);
  });

  it("resolveTierModel returns the default when no override", () => {
    expect(resolveTierModel("cortex", {})).toBe(DEFAULT_TIER_MODEL.cortex);
  });

  it("resolveTierModel throws on a non-allowlisted override (fail-closed)", () => {
    expect(() => resolveTierModel("cortex", { LLM_MODEL_CORTEX: "gpt-5-secret" })).toThrow(/tier_model_not_allowed/);
  });

  it("resolveAllowlistedModel accepts allowlisted, rejects unknown", () => {
    expect(resolveAllowlistedModel("cortex", "z-ai/glm-5.3-flash")).toBe("z-ai/glm-5.3-flash");
    expect(() => resolveAllowlistedModel("cortex", "bogus-model")).toThrow(/tier_model_not_allowed/);
  });

  it("cortex ranks below money; a money agent can run cortex, not vice versa", () => {
    expect(rankOf("cortex")).toBeLessThan(rankOf("money"));
    expect(tierSatisfies("money", "cortex")).toBe(true);
    expect(tierSatisfies("cortex", "money")).toBe(false);
  });

  it("isLlmTier recognizes the new tier", () => {
    expect(isLlmTier("cortex")).toBe(true);
    expect(isLlmTier("local")).toBe(true);
    expect(isLlmTier("nope")).toBe(false);
  });

  it("local tier never admits the money model; rank is below money", () => {
    expect(TIER_MODEL_ALLOWLIST.local).not.toContain("deepseek/deepseek-r1");
    expect(rankOf("local")).toBeLessThan(rankOf("money"));
    expect(tierSatisfies("money", "local")).toBe(true);
    expect(tierSatisfies("local", "money")).toBe(false);
  });

  it("local allowlist is env-extendable WITHOUT a rebuild; other tiers are not", () => {
    process.env.LOCAL_MODEL_ALLOWLIST = "gemma4-31b-heretic-64k";
    expect(tierAllowlist("local")).toContain("gemma4-31b-heretic-64k");
    expect(resolveAllowlistedModel("local", "gemma4-31b-heretic-64k")).toBe("gemma4-31b-heretic-64k");
    // env extension cannot leak into other tiers
    expect(tierAllowlist("neuron")).not.toContain("gemma4-31b-heretic-64k");
    expect(() => resolveAllowlistedModel("neuron", "gemma4-31b-heretic-64k")).toThrow(/tier_model_not_allowed/);
    delete process.env.LOCAL_MODEL_ALLOWLIST;
  });

  it("non-money tiers are env-extendable via LLM_MODEL_ALLOWLIST_<TIER>", () => {
    process.env.LLM_MODEL_ALLOWLIST_CORTEX = "openai/gpt-4.1-mini";
    expect(tierAllowlist("cortex")).toContain("openai/gpt-4.1-mini");
    // money stays code-pinned and cannot be env-widened
    process.env.LLM_MODEL_ALLOWLIST_CORTEX = "deepseek/deepseek-r1";
    expect(tierAllowlist("cortex")).not.toContain("deepseek/deepseek-r1");
    delete process.env.LLM_MODEL_ALLOWLIST_CORTEX;
  });
});
