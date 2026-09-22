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

export interface TierCompleteOptions {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  /** Explicit non-default model id — MUST be allowlisted for the tier. */
  model?: string;
}

/**
 * Executes a completion on the given tier. Throws on unknown tier, disallowed
 * model, or any gateway failure. Returns raw text; parse JSON at call sites.
 */
export async function completeTier(
  tier: LlmTier,
  opts: TierCompleteOptions,
  config: LlmGatewayConfig | null = null
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
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
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

export { DEFAULT_TIER_MODEL, TIER_MODEL_ALLOWLIST, TIER_MODEL_ENV };
