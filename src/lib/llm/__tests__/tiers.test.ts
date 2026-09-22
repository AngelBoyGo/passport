import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_MODEL,
  TIER_MODEL_ALLOWLIST,
  resolveTierModel,
  requireLlmTier,
  tierSatisfies,
} from "../tiers";
import { completeTier, getGatewayConfig } from "../gateway-client";

describe("tiers — table + resolution", () => {
  it("pins the verified gateway model ids (live-verified 2026-09-22)", () => {
    expect(DEFAULT_TIER_MODEL.neuron).toBe("deepseek-v4-flash");
    expect(DEFAULT_TIER_MODEL.money).toBe("deepseek-v4-pro");
    expect(TIER_MODEL_ALLOWLIST.money).toEqual(["deepseek-v4-pro"]);
  });

  it("resolves env overrides when they are on the tier allowlist", () => {
    const env = { LLM_MODEL_NEURON: "deepseek-v4-flash" };
    expect(resolveTierModel("neuron", env)).toBe("deepseek-v4-flash");
  });

  it("REFUSES env overrides that are not allowlisted for the tier", () => {
    // The critical fail-safe: an env var can never point the money tier at a
    // weaker model (or the neuron tier at the Pro model either).
    expect(() => resolveTierModel("money", { LLM_MODEL_MONEY: "deepseek-v4-flash" })).toThrow(
      /tier_model_not_allowed/
    );
    expect(() => resolveTierModel("neuron", { LLM_MODEL_NEURON: "gpt-4o-mini" })).toThrow(
      /tier_model_not_allowed/
    );
  });

  it("rejects unknown tiers outright", () => {
    expect(() => requireLlmTier("gpt-4o-mini")).toThrow(/unknown_llm_tier/);
    expect(() => requireLlmTier(undefined)).toThrow(/unknown_llm_tier/);
    expect(() => requireLlmTier("")).toThrow(/unknown_llm_tier/);
  });
});

describe("tiers — upgrade-only invariant", () => {
  it("a neuron agent CANNOT run money-tier work", () => {
    expect(tierSatisfies("neuron", "money")).toBe(false);
  });

  it("a money agent can run neuron-tier work (rank high covers low)", () => {
    expect(tierSatisfies("money", "neuron")).toBe(true);
  });

  it("same tier always satisfies", () => {
    expect(tierSatisfies("neuron", "neuron")).toBe(true);
    expect(tierSatisfies("money", "money")).toBe(true);
  });
});

describe("gateway-client — authorization before transport", () => {
  const cfg = { baseUrl: "https://gw.example/api/gateway/v1", apiKey: "vk_test" };

  it("throws on unknown tier BEFORE touching the network", async () => {
    await expect(
      // @ts-expect-error deliberate runtime tier violation
      completeTier("gpt-4o-mini", { system: "s", user: "u" }, cfg)
    ).rejects.toThrow(/unknown_llm_tier/);
  });

  it("rejects a cross-tier explicit model injection", async () => {
    await expect(
      completeTier(
        "neuron",
        { system: "s", user: "u", model: "deepseek-v4-pro" },
        cfg
      )
    ).rejects.toThrow(/tier_model_not_allowed/);
    await expect(
      completeTier("money", { system: "s", user: "u", model: "deepseek-v4-flash" }, cfg)
    ).rejects.toThrow(/tier_model_not_allowed/);
  });

  it("throws fail-closed when the gateway env is unset", () => {
    expect(() => getGatewayConfig({})).toThrow(/not configured/);
  });

  it("sends the resolved tier model (not a caller-chosen one) to the gateway", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      await completeTier("neuron", { system: "s", user: "u" }, cfg);
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.model).toBe("deepseek-v4-flash");
      expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer vk_test" });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("throws (never degrades) on gateway failure", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    try {
      await expect(
        completeTier("neuron", { system: "s", user: "u" }, cfg)
      ).rejects.toThrow(/LLM gateway returned 500/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
