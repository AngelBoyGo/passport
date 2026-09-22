/**
 * LLM tier table for the fleet control plane.
 *
 * Design invariants (owner-approved):
 *   1. UPON-ONLY tiering: a caller provisioned at tier X may only execute work
 *      at tier X or higher, never lower. Fallbacks climb, never drop.
 *   2. MONEY-ONLY tier: the `money` tier is the ONLY tier that may execute
 *      wallet/ledger/escrow mutations, and its model comes from a server-side
 *      allowlist. An env var can never point the money tier at a weaker model.
 *   3. Fail-closed: unset gateway env or unverifiable model resolution throws
 *      (never silently degrades to a cheaper path).
 *
 * Model IDs verified live against the api.metis.gold (KeyForge) gateway on
 * 2026-09-22: `deepseek-v4-flash` and `deepseek-v4-pro` are both present.
 */

export const LLM_TIERS = ["neuron", "money"] as const;

export type LlmTier = (typeof LLM_TIERS)[number];

/**
 * Server-side allowlist: tier → permitted model IDs. Higher rank = stronger.
 * The `money` tier admits ONLY the verified Pro model — this constant is the
 * enforcement point for "money moves only through Pro".
 */
export const TIER_MODEL_ALLOWLIST: Record<LlmTier, readonly string[]> = {
  neuron: ["deepseek-v4-flash"],
  money: ["deepseek-v4-pro"],
};

export const DEFAULT_TIER_MODEL: Record<LlmTier, string> = {
  neuron: "deepseek-v4-flash",
  money: "deepseek-v4-pro",
};

/** Env var name per tier (overrides must still be on the tier allowlist). */
export const TIER_MODEL_ENV: Record<LlmTier, string> = {
  neuron: "LLM_MODEL_NEURON",
  money: "LLM_MODEL_MONEY",
};

const TIER_RANK: Record<LlmTier, number> = { neuron: 0, money: 1 };

export function rankOf(tier: LlmTier): number {
  return TIER_RANK[tier];
}

/**
 * Upgrade-only invariant: `provisioned` may run `requested` only when its rank
 * is equal or higher. A neuron agent CANNOT run money-tier work — the calling
 * code must dispatch to an agent provisioned at the money tier.
 */
export function tierSatisfies(provisioned: LlmTier, requested: LlmTier): boolean {
  return TIER_RANK[provisioned] >= TIER_RANK[requested];
}

export function isLlmTier(value: unknown): value is LlmTier {
  return typeof value === "string" && (LLM_TIERS as readonly string[]).includes(value);
}

/** Unknown tier / not-a-tier → throw. Callers cannot sneak past the table. */
export function requireLlmTier(value: unknown): LlmTier {
  if (!isLlmTier(value)) {
    throw new Error(`unknown_llm_tier:${String(value)}`);
  }
  return value;
}

/** Default or env-overridden model for a tier, validated against the allowlist. */
export function resolveTierModel(tier: LlmTier, env: Record<string, string | undefined> = process.env): string {
  const override = env[TIER_MODEL_ENV[tier]]?.trim();
  if (!override) return DEFAULT_TIER_MODEL[tier];
  if (!TIER_MODEL_ALLOWLIST[tier].includes(override)) {
    throw new Error(`tier_model_not_allowed:${tier}:${override}`);
  }
  return override;
}
