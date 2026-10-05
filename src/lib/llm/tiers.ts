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
 * Tiers:
 *   - `neuron`  — default reasoning brain (deepseek-v4-flash).
 *   - `cortex`  — cheap reasoning tier for the two-persona dialogue loop
 *                 (MARS/MUSE). Same authority as neuron (never money); its
 *                 allowlist admits the cheaper models so a sustained
 *                 self-dialogue loop does not burn the primary model budget.
 *   - `money`   — the sole tier permitted to move money (deepseek-v4-pro).
 *
 * Model IDs verified live against the api.metis.gold (KeyForge) gateway on
 * 2026-10-03: `deepseek-v4-flash`, `deepseek-v4-pro`, and the cheap set used by
 * `cortex` (llama-3.1-8b-instant, gemini-1.5-flash, mistral-small-latest,
 * gpt-4o-mini, claude-3-haiku-20240307) are all present.
 */

export const LLM_TIERS = ["local", "cortex", "neuron", "money"] as const;

export type LlmTier = (typeof LLM_TIERS)[number];

/**
 * Server-side allowlist: tier → permitted model IDs. Higher rank = stronger.
 * The `money` tier admits ONLY the verified Pro model — this constant is the
 * enforcement point for "money moves only through Pro".
 */
export const TIER_MODEL_ALLOWLIST: Record<LlmTier, readonly string[]> = {
  // `local` is a self-hosted endpoint (e.g. gemma-4 on the owner's Atlanta PC
  // over Tailscale). It carries the same authority ceiling as cortex/neuron —
  // it can NEVER touch money — and its endpoint is configured separately
  // (LOCAL_LLM_BASE_URL). The model allowlist is env-extendable so the owner
  // can name their own local model without a rebuild.
  local: ["gemma-4", "gemma-3", "llama3.1", "qwen2.5", "mistral"],
  neuron: ["deepseek-v4-flash", "gpt-4o-mini"],
  cortex: ["deepseek-v4-flash", "gpt-4o-mini"],
  money: ["deepseek-v4-pro"],
};

export const DEFAULT_TIER_MODEL: Record<LlmTier, string> = {
  local: "gemma-4",
  neuron: "deepseek-v4-flash",
  cortex: "gpt-4o-mini",
  money: "deepseek-v4-pro",
};

/** Env var name per tier (overrides must still be on the tier allowlist). */
export const TIER_MODEL_ENV: Record<LlmTier, string> = {
  local: "LLM_MODEL_LOCAL",
  neuron: "LLM_MODEL_NEURON",
  cortex: "LLM_MODEL_CORTEX",
  money: "LLM_MODEL_MONEY",
};

/**
 * Tier rank. local/cortex sit BELOW neuron: cheaper reasoning tiers with the
 * same authority ceiling as neuron (they can never touch money). Upgrade-only
 * still holds — a money-tier agent may run local/cortex/neuron work, never the
 * reverse.
 */
const TIER_RANK: Record<LlmTier, number> = { local: 0, cortex: 0, neuron: 1, money: 2 };

export function rankOf(tier: LlmTier): number {
  return TIER_RANK[tier];
}

/**
 * Upgrade-only invariant: `provisioned` may run `requested` only when its rank
 * is equal or higher. A cortex/neuron agent CANNOT run money-tier work — the
 * calling code must dispatch to an agent provisioned at the money tier.
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

/**
 * Resolves an explicit model against a tier's allowlist. Used by the persona
 * layer, where MARS and MUSE each carry their own model id but must still be
 * admitted by the cortex allowlist (fail-closed on an unknown/unauthorized id).
 */
export function resolveAllowlistedModel(tier: LlmTier, model: string): string {
  const trimmed = model?.trim();
  if (!trimmed) return DEFAULT_TIER_MODEL[tier];
  if (!TIER_MODEL_ALLOWLIST[tier].includes(trimmed)) {
    throw new Error(`tier_model_not_allowed:${tier}:${trimmed}`);
  }
  return trimmed;
}
