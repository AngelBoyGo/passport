/**
 * Rail Factory brain — a genuine LLM call through the api.metis.gold KeyForge gateway.
 *
 * Uses native `fetch` against an OpenAI-compatible `/chat/completions` endpoint (no SDK
 * dependency), configured by LLM_BASE_URL / LLM_API_KEY / LLM_MODEL. The key is a KeyForge
 * virtual key (vk_...) whose scope/quota/spend-cap is enforced by the gateway, which routes
 * through the caller's own provider keys.
 *
 * Fail-closed: any non-2xx response, timeout, or unparseable JSON is surfaced as an error so
 * callers mark the item `needsReview` — never silently enabling a rail on a hallucinated
 * output. There is no heuristic fallback.
 */

import { prisma } from "@/lib/db";

export interface BrainConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function getBrainConfig(): BrainConfig | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

const BRAIN_TIMEOUT_MS = 30_000;

export async function brainComplete(opts: {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
}): Promise<string> {
  const cfg = getBrainConfig();
  if (!cfg) {
    throw new Error("LLM gateway not configured (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
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

/** Parses model output, tolerating ```json fences; throws on invalid/absent object. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM JSON output was not an object");
  }
  return parsed as Record<string, unknown>;
}

async function auditBrainRun(action: string, targetId: string, summary: string): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        operatorId: "raillab_factory",
        action,
        targetId,
        details: summary.slice(0, 1000),
      },
    });
  } catch {
    // Audit is best-effort; never block the factory on an audit write.
  }
}

/** Scores a discovery candidate (fit × demand × gate × novelty) and returns a rationale. */
export async function scoreCandidate(
  candidate: { name: string; category: string; providerKey: string; raw?: Record<string, unknown> }
): Promise<{ score: number; rationale: string }> {
  const user = JSON.stringify({
    name: candidate.name,
    category: candidate.category,
    providerKey: candidate.providerKey,
    raw: candidate.raw ?? {},
  });
  const out = parseJsonObject(
    await brainComplete({
      system:
        "You are the Passport ASMC-3 rail-discovery scorer. Evaluate a settlement-rail candidate " +
        "for fit with a commodity-backed autonomous agent economy (Sahel). Return STRICT JSON: " +
        '{"score": <float 0..1>, "rationale": "<2-3 sentence justification>"}. ' +
        "Score higher for: verifiable idempotency, low fee, agent-usability, commodity/revenue fit. " +
        "No prose outside the JSON object.",
      user,
      json: true,
    })
  );
  const score = Number(out.score);
  if (!Number.isFinite(score)) {
    throw new Error("LLM score was not a number");
  }
  const clamped = Math.min(1, Math.max(0, score));
  const rationale = String(out.rationale ?? "");
  await auditBrainRun("raillab_brain_score", candidate.name, rationale);
  return { score: clamped, rationale };
}

/** Generalizes 3+ structurally-similar sample specs into a shared blueprint template. */
export async function generalizeRunbook(
  samples: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  const out = parseJsonObject(
    await brainComplete({
      system:
        "You generalize a set of hand-provisioned settlement rails into a reusable blueprint. " +
        "Return STRICT JSON with a 'template' object containing the shared spec fields " +
        '(category, ledgerKind, kycTier, feeBps, endpoints shape, idempotencyKeyPath, fxActor) ' +
        "and a 'parameters' array of the variable fields. No prose outside JSON.",
      user: JSON.stringify({ samples }),
      json: true,
    })
  );
  await auditBrainRun("raillab_brain_generalize", String(samples.length), "generalized runbook");
  return out;
}

/** Writes a human-readable proposal rationale for an auto-generated RailSpec. */
export async function writeProposalRationale(spec: Record<string, unknown>): Promise<string> {
  const out = parseJsonObject(
    await brainComplete({
      system:
        "You write a 2-3 sentence justification for auto-proposing a settlement rail. " +
        'Return STRICT JSON: {"rationale": "<justification>"}. No prose outside JSON.',
      user: JSON.stringify(spec),
      json: true,
    })
  );
  const rationale = String(out.rationale ?? "");
  await auditBrainRun("raillab_brain_proposal", String(spec.name ?? spec.railKey ?? ""), rationale);
  return rationale;
}
