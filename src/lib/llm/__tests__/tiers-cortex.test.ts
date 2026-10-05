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

afterEach(() => { delete process.env.LOCAL_MODEL_ALLOWLIST; });

describe("llm tiers — cortex expansion", () => {
  it("has the 4 tiers: local, cortex, neuron, money", () => {
    expect(LLM_TIERS).toEqual(["local", "cortex", "neuron", "money"]);
  });

  it("cortex admits only cheap, allowlisted models", () => {
    expect(TIER_MODEL_ALLOWLIST.cortex).toContain("gpt-4o-mini");
    expect(TIER_MODEL_ALLOWLIST.cortex).toContain("deepseek-v4-flash");
    // money-tier model is never admitted on cortex
    expect(TIER_MODEL_ALLOWLIST.cortex).not.toContain("deepseek-v4-pro");
  });

  it("money tier admits only the pro model", () => {
    expect(TIER_MODEL_ALLOWLIST.money).toEqual(["deepseek-v4-pro"]);
  });

  it("resolveTierModel returns the default when no override", () => {
    expect(resolveTierModel("cortex", {})).toBe(DEFAULT_TIER_MODEL.cortex);
  });

  it("resolveTierModel throws on a non-allowlisted override (fail-closed)", () => {
    expect(() => resolveTierModel("cortex", { LLM_MODEL_CORTEX: "gpt-5-secret" })).toThrow(/tier_model_not_allowed/);
  });

  it("resolveAllowlistedModel accepts allowlisted, rejects unknown", () => {
    expect(resolveAllowlistedModel("cortex", "gpt-4o-mini")).toBe("gpt-4o-mini");
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
    expect(TIER_MODEL_ALLOWLIST.local).not.toContain("deepseek-v4-pro");
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
});
