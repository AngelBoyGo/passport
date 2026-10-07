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
  tierAllowlist,
  type LlmTier,
  requireLlmTier,
  resolveTierModel,
} from "./tiers";

export interface LlmGatewayConfig {
  baseUrl: string;
  apiKey: string;
}

const GATEWAY_TIMEOUT_MS = 30_000;

/**
 * Local self-hosted generation needs a much longer budget: the owner's
 * gemma4-31b-heretic-64k runs ~5.8 tok/s (partial CPU offload) and shares only
 * 2 parallel slots, so a legitimate response can take minutes — especially when
 * another opencode instance holds a slot. Default 300s (5 min); override with
 * LOCAL_LLM_TIMEOUT_MS.
 */
export function localTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LOCAL_LLM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

export function getGatewayConfig(env: Record<string, string | undefined> = process.env): LlmGatewayConfig {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error("LLM gateway not configured (LLM_BASE_URL / LLM_API_KEY)");
  }
  return { baseUrl, apiKey };
}

/**
 * Per-tier endpoint resolution.
 *
 * The `local` tier may point at a SELF-HOSTED OpenAI-compatible server (e.g. a
 * gemma-4 instance on the owner's machine, reachable over Tailscale) instead of
 * the KeyForge gateway. Configured via LOCAL_LLM_BASE_URL (+ optional
 * LOCAL_LLM_API_KEY; defaults to a placeholder key since many local servers
 * ignore it). All other tiers use the shared gateway. The money tier is NEVER
 * routable to a local endpoint — a local model must never move money.
 */
export function getTierGatewayConfig(
  tier: LlmTier,
  env: Record<string, string | undefined> = process.env
): LlmGatewayConfig {
  if (tier === "local") {
    const baseUrl = env.LOCAL_LLM_BASE_URL?.trim();
    if (!baseUrl) {
      throw new Error(
        "local tier not configured (set LOCAL_LLM_BASE_URL to the Tailscale-reachable endpoint, e.g. http://<atlanta-tailscale-ip>:11434/v1)"
      );
    }
    return { baseUrl, apiKey: env.LOCAL_LLM_API_KEY?.trim() || "local" };
  }
  return getGatewayConfig(env);
}

export type ChatRole = "system" | "user" | "assistant";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max";
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
  /** OpenAI-compatible reasoning control (Ollama maps `none` to think=false). */
  reasoningEffort?: ReasoningEffort;
  /** Bounded output tokens; useful for the local persona on constrained VRAM. */
  maxTokens?: number;
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
  const cfg = config ?? getTierGatewayConfig(tier);

  // Resolve the model WITHOUT throwing on a bad tier-env override when the
  // caller supplied an explicit allowlisted model. Previously resolveTierModel
  // ran unconditionally, so a stale LLM_MODEL_<TIER> (e.g. a legacy id from the
  // env template) threw before the valid explicit model was applied — killing
  // every persona call. Now the env default is only consulted when needed.
  let model: string;
  if (opts.model) {
    if (!tierAllowlist(tier).includes(opts.model)) {
      throw new Error(`tier_model_not_allowed:${tier}:${opts.model}`);
    }
    model = opts.model;
  } else {
    model = resolveTierModel(tier);
  }

  // Tier-aware timeout: local self-hosted generation (a 31B model) is much
  // slower than the cloud gateway, so give the local tier a longer budget.
  const timeoutMs = tier === "local" ? localTimeoutMs() : GATEWAY_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
        ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
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

  const allowed = tierAllowlist(tier);
  // Primary = caller's explicit allowlisted model, else the env-resolved tier
  // model (honouring LLM_MODEL_<TIER>; fail-closed on a disallowed override).
  const primary = opts.model ?? resolveTierModel(tier);
  if (!allowed.includes(primary)) {
    throw new Error(`tier_model_not_allowed:${tier}:${primary}`);
  }
  // Fallback chain = the other allowlisted models for this tier (never another
  // tier). EXCEPTION: the local tier retries the SAME model only — the owner's
  // GPU fits exactly one large model (~532 MiB headroom), so trying another
  // local model would force a 21.9 GB unload/reload storm.
  const chain = tier === "local" ? [primary] : [primary, ...allowed.filter((m) => m !== primary)];

  let lastErr: unknown = null;
  for (const model of chain) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      try {
        return await completeTier(tier, { ...opts, model }, resilient.config ?? null, resilient.fetchImpl);
      } catch (err) {
        lastErr = err;
        // Transport-level failure (DNS/connection refused — "fetch failed"):
        // EVERY model on this tier shares the same host, so trying the other
        // models is pointless. Fail immediately (also avoids burning through
        // the whole chain + retry delays when a host is down).
        if (isTransportFailure(err)) {
          throw new Error(
            `LLM gateway unreachable (${model}): ${err instanceof Error ? err.message : String(err)}`
          );
        }
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

/** True when the error is a transport/connectivity failure, not a model response. */
export function isTransportFailure(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  const name = (err as { name?: string })?.name || "";
  return (
    name === "AbortError" ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("ehostunreach") ||
    msg.includes("enetunreach") ||
    msg.includes("operation was aborted") ||
    msg.includes("the operation was aborted") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
}

/**
 * Parse-aware resilient completion.
 *
 * AUDIT FIX: the plain `completeTierResilient` only retries when `completeTier`
 * itself throws (non-2xx/timeout/empty). Malformed JSON is parsed by the CALLER,
 * after the wrapper returns — so a model that consistently emits broken JSON
 * never triggered the fallback. This variant takes the parse function so a parse
 * failure is treated as a retryable/fallback-able failure too.
 */
export async function completeTierResilientParsed<T>(
  tier: LlmTier,
  opts: TierCompleteOptions,
  parse: (raw: string) => T,
  resilient: ResilientOptions = {}
): Promise<T> {
  requireLlmTier(tier);
  const attemptsPerModel = Math.max(1, resilient.attemptsPerModel ?? 2);
  const retryDelayMs = Math.max(0, resilient.retryDelayMs ?? 250);

  const allowed = tierAllowlist(tier);
  const primary = opts.model ?? resolveTierModel(tier);
  if (!allowed.includes(primary)) {
    throw new Error(`tier_model_not_allowed:${tier}:${primary}`);
  }
  // Local tier: same model only (only one large model fits in VRAM).
  const chain = tier === "local" ? [primary] : [primary, ...allowed.filter((m) => m !== primary)];

  let lastErr: unknown = null;
  for (const model of chain) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      try {
        const raw = await completeTier(tier, { ...opts, model }, resilient.config ?? null, resilient.fetchImpl);
        return parse(raw); // a malformed-JSON throw here is retryable
      } catch (err) {
        lastErr = err;
        if (isTransportFailure(err)) {
          throw new Error(
            `LLM gateway unreachable (${model}): ${err instanceof Error ? err.message : String(err)}`
          );
        }
        if (attempt < attemptsPerModel - 1 && retryDelayMs > 0) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
    }
  }
  throw new Error(
    `LLM gateway (parsed) failed after ${chain.length} model(s) × ${attemptsPerModel} attempt(s): ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

export { DEFAULT_TIER_MODEL, TIER_MODEL_ALLOWLIST, TIER_MODEL_ENV };
