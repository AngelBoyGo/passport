/**
 * Tier-aware LLM gateway client (api.metis.gold / KeyForge, OpenAI-compatible).
 *
 * The control plane's single transport for EVERY model call. Tier + model are
 * resolved through src/lib/llm/tiers.ts — callers never pass a raw model id,
 * so a cheap agent class can never request the money-tier model and the money
 * tier can never resolve to a weaker model (the allowlist is server-side).
 *
 * Fail-closed: unset env → throw; non-2xx/timeout/empty → throw. No heuristic
 * fallback. Higher-tier retries must be an explicit caller decision.
 */

import {
  DEFAULT_TIER_MODEL,
  TIER_MODEL_ALLOWLIST,
  TIER_MODEL_ENV,
  type LlmTier,
  requireLlmTier,
  resolveTierModel,
} from "./tiers";

export interface LlmGatewayConfig {
  baseUrl: string;
  apiKey: string;
}

const GATEWAY_TIMEOUT_MS = 30_000;

export function getGatewayConfig(env: Record<string, string | undefined> = process.env): LlmGatewayConfig {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error("LLM gateway not configured (LLM_BASE_URL / LLM_API_KEY)");
  }
  return { baseUrl, apiKey };
}

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TierCompleteOptions {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  /** Explicit non-default model id — MUST be allowlisted for the tier. */
  model?: string;
  /**
   * Multi-turn conversation. When present it REPLACES the default
   * [system, user] pair — used by the two-persona dialogue loop
   * (Plan → Critique → Revise → Commit). Single-turn callers leave it unset
   * and behave exactly as before.
   */
  messages?: ChatMessage[];
}

/**
 * Executes a completion on the given tier. Throws on unknown tier, disallowed
 * model, or any gateway failure. Returns raw text; parse JSON at call sites.
 * `fetchImpl` is injectable for tests only.
 */
export async function completeTier(
  tier: LlmTier,
  opts: TierCompleteOptions,
  config: LlmGatewayConfig | null = null,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  requireLlmTier(tier);
  const cfg = config ?? getGatewayConfig();

  let model = resolveTierModel(tier);
  if (opts.model) {
    if (!TIER_MODEL_ALLOWLIST[tier].includes(opts.model)) {
      throw new Error(`tier_model_not_allowed:${tier}:${opts.model}`);
    }
    model = opts.model;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    // Multi-turn callers supply the full message list; single-turn callers use
    // the [system, user] pair. An explicitly empty messages array falls back to
    // the pair so a caller bug can never produce a zero-message request.
    const messages =
      opts.messages && opts.messages.length > 0
        ? opts.messages
        : [
            { role: "system" as const, content: opts.system },
            { role: "user" as const, content: opts.user },
          ];
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM gateway returned ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM gateway returned an empty completion");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Bounded retry + same-tier fallback around completeTier.
 *
 * The primary gateway model intermittently returns empty completions or
 * malformed JSON (observed in prod as "LLM_UNAVAILABLE"). A single transient
 * glitch should not drop a brain cycle. This wrapper:
 *   - retries the SAME model up to `attemptsPerModel` times on any failure;
 *   - if that model is exhausted, falls back to the NEXT allowlisted model on
 *     the SAME tier (never another tier — the money model is never used here);
 *   - throws (fail-closed) when every model × attempt fails.
 *
 * It never performs side effects, so retrying is safe (idempotent reads). The
 * caller's model is respected as the primary; the tier default is second.
 */
export interface ResilientOptions {
  config?: LlmGatewayConfig | null;
  fetchImpl?: typeof fetch;
  attemptsPerModel?: number;
  retryDelayMs?: number;
}

export async function completeTierResilient(
  tier: LlmTier,
  opts: TierCompleteOptions,
  resilient: ResilientOptions = {}
): Promise<string> {
  requireLlmTier(tier);
  const attemptsPerModel = Math.max(1, resilient.attemptsPerModel ?? 2);
  const retryDelayMs = Math.max(0, resilient.retryDelayMs ?? 250);

  const allowed = TIER_MODEL_ALLOWLIST[tier];
  // Primary = caller's explicit allowlisted model, else the tier default.
  const primary = opts.model ?? DEFAULT_TIER_MODEL[tier];
  if (!allowed.includes(primary)) {
    throw new Error(`tier_model_not_allowed:${tier}:${primary}`);
  }
  // Fallback chain = the other allowlisted models for this tier (never another tier).
  const chain = [primary, ...allowed.filter((m) => m !== primary)];

  let lastErr: unknown = null;
  for (const model of chain) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      try {
        return await completeTier(tier, { ...opts, model }, resilient.config ?? null, resilient.fetchImpl);
      } catch (err) {
        lastErr = err;
        if (attempt < attemptsPerModel - 1 && retryDelayMs > 0) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
    }
  }
  throw new Error(
    `LLM gateway failed after ${chain.length} model(s) × ${attemptsPerModel} attempt(s): ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

export { DEFAULT_TIER_MODEL, TIER_MODEL_ALLOWLIST, TIER_MODEL_ENV };