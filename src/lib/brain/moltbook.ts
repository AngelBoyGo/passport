/**
 * Moltbook integration — the brain reads/learns from the AI-agent forum, registers
 * an agent account, and can post/comment to engage the community.
 *
 * RECONCILIATION WITH THE TRUST MODEL:
 *   Moltbook is an EXTERNAL, untrusted surface. Everything fetched is treated as
 *   UNKNOWN trust, hashed (sha256), and prompt-injection-scanned before it is
 *   persisted as evidence. Findings may SEED missions/proposals but are never
 *   treated as verified fact and never execute anything.
 *
 * API (https://www.moltbook.com/api/v1 — the `www` host is REQUIRED; the
 * non-www host redirects and strips the Authorization header):
 *   - POST /agents/register        (unauthenticated) → api_key, claim_url, code
 *   - GET  /agents/me | /home      (Bearer key)
 *   - GET  /feed | /posts          (Bearer key)
 *   - POST /posts                  (Bearer key; reverse-CAPTCHA gated)
 *   - POST /posts/:id/comments     (Bearer key; reverse-CAPTCHA gated)
 *   - POST /verify             — submolt the CAPTCHA answer (no crypto here)
 *
 * Posting is opt-in (MOLTBOOK_POST_ENABLED) and requires solving a reverse-CAPTCHA
 * (lobster-themed math word problem) within 5 minutes. The solver uses MUSE's
 * cheap model to parse the obfuscated text and compute the answer.
 *
 * The API key is NEVER logged and NEVER sent anywhere except www.moltbook.com.
 */

import { prisma } from "@/lib/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { scanForPromptInjection } from "@/lib/brain/external-research";
import { brainComplete } from "@/lib/raillab/factory-brain";

export const MOLTBOOK_BASE = "https://www.moltbook.com/api/v1";

export interface MoltbookItemRecord {
  kind: string;
  title: string | null;
  body: string;
  author: string | null;
  sourceUrl: string | null;
  injectionScan: { safe: boolean; matched: string[] };
  trustLevel: "UNKNOWN";
}

export interface MoltbookReadResult {
  fetched: number;
  stored: number;
  llm_used: false;
}

function apiKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.MOLTBOOK_API_KEY?.trim() || null;
}

export function moltbookConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(apiKey(env));
}

/**
 * Registers a new Moltbook agent. Returns the api_key + claim_url + code. The
 * caller MUST persist the key as a secret and send the claim_url to the owner
 * (human claim is mandatory on Moltbook — the agent cannot self-activate).
 */
export async function registerMoltbookAgent(
  input: { name: string; description: string },
  fetchImpl: typeof fetch = fetch
): Promise<
  | { ok: true; apiKey: string; claimUrl: string; verificationCode: string }
  | { ok: false; reason: string }
> {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || !description) return { ok: false, reason: "name_and_description_required" };
  try {
    const res = await fetchImpl(`${MOLTBOOK_BASE}/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `register_http_${res.status}:${body.slice(0, 160)}` };
    }
    const data = (await res.json()) as {
      agent?: { api_key?: string; claim_url?: string; verification_code?: string };
    };
    const key = data.agent?.api_key;
    const claimUrl = data.agent?.claim_url;
    const code = data.agent?.verification_code;
    if (!key || !claimUrl) return { ok: false, reason: "register_missing_fields" };
    return { ok: true, apiKey: key, claimUrl, verificationCode: code ?? "" };
  } catch (err) {
    return { ok: false, reason: `register_error:${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
  }
}

/** GET an authenticated Moltbook endpoint. Returns parsed JSON or null. */
async function moltbookGet(path: string, fetchImpl: typeof fetch = fetch): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetchImpl(`${MOLTBOOK_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function hashContent(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)));
}

/** Normalizes arbitrary Moltbook payloads (posts/comments/home) into records. */
export function normalizeMoltbookItems(raw: unknown, kind: string): MoltbookItemRecord[] {
  const out: MoltbookItemRecord[] = [];
  const push = (o: Record<string, unknown>) => {
    const body = String(o.body ?? o.content ?? o.text ?? o.title ?? "").trim();
    if (!body) return;
    const title = o.title != null ? String(o.title) : null;
    const author =
      o.author != null
        ? String((o.author as Record<string, unknown>)?.username ?? o.author)
        : o.agent_name != null
          ? String(o.agent_name)
          : null;
    const sourceUrl = o.url != null ? String(o.url) : o.id != null ? `${MOLTBOOK_BASE}/posts/${String(o.id)}` : null;
    const scan = scanForPromptInjection(`${title ?? ""}\n${body}`);
    out.push({ kind, title, body: body.slice(0, 4000), author, sourceUrl, injectionScan: scan, trustLevel: "UNKNOWN" });
  };

  if (Array.isArray(raw)) {
    for (const e of raw) if (e && typeof e === "object") push(e as Record<string, unknown>);
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const arr = Array.isArray(o.items) ? o.items : Array.isArray(o.posts) ? o.posts : Array.isArray(o.data) ? o.data : null;
    if (arr) for (const e of arr) if (e && typeof e === "object") push(e as Record<string, unknown>);
    else push(o);
  }
  return out;
}

/** Persists normalized items with dedupe on contentHash. Returns how many were new. */
export async function persistMoltbookItems(items: MoltbookItemRecord[]): Promise<number> {
  let stored = 0;
  for (const it of items) {
    const contentHash = hashContent(`${it.kind}:${it.title ?? ""}:${it.body}`);
    try {
      await prisma.moltbookItem.create({
        data: {
          contentHash,
          kind: it.kind,
          title: it.title,
          body: it.body,
          author: it.author,
          sourceUrl: it.sourceUrl,
          injectionScan: it.injectionScan as never,
          trustLevel: it.trustLevel,
        },
      });
      stored++;
    } catch (err) {
      // AUDIT FIX (L1): only a unique-constraint violation (P2002) means
      // "already seen". Any other write error is a real failure and must not be
      // silently swallowed as dedupe.
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") {
        console.warn("[moltbook] persist failed (non-dedupe):", err instanceof Error ? err.message : String(err));
      }
    }
  }
  return stored;
}

/**
 * One read/learn pass: fetch /home + /posts + /feed, normalize, hash, injection-
 * scan, persist. Read-only — never posts, never executes. Records an evidence
 * row so the brain can cite Moltbook as a research source.
 */
export async function moltbookRead(
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<MoltbookReadResult> {
  const f = opts.fetchImpl ?? fetch;
  if (!moltbookConfigured()) return { fetched: 0, stored: 0, llm_used: false };

  const [home, posts, feed] = await Promise.all([
    moltbookGet("/home", f),
    moltbookGet("/posts?sort=new&limit=10", f),
    moltbookGet("/feed?sort=new&limit=10", f),
  ]);

  const items = [
    ...normalizeMoltbookItems(home, "home"),
    ...normalizeMoltbookItems(posts, "post"),
    ...normalizeMoltbookItems(feed, "post"),
  ];
  const stored = await persistMoltbookItems(items);

  // Record the read in the brain's own memory so its cycles and the dialogue
  // see fresh external intelligence. Fires whenever items were fetched (even if
  // all were already-seen) so active reading is visible, not just the delta.
  if (items.length > 0) {
    const titles = items
      .slice(0, 4)
      .map((i) => (i.title || i.body).slice(0, 80))
      .join(" | ");
    await prisma.brainMemory
      .create({
        data: {
          kind: "OBSERVATION",
          summary: `moltbook: read ${items.length} item(s) (${stored} new) — ${titles}`.slice(0, 500),
          data: { source: "moltbook", stored, fetched: items.length } as never,
        },
      })
      .catch(() => undefined);
  }

  // Evidence row (best-effort) so the read is auditable + citable by missions.
  const digest = hashContent(JSON.stringify(items.map((i) => i.body.slice(0, 200))));
  await prisma.agentEvidence
    .create({
      data: {
        sourceType: "moltbook_research",
        artifactType: "report",
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: new Date(),
        agentIdentityCommitment: "command-brain",
        eventCommitmentHash: `moltbook_${digest.slice(0, 40)}`,
        sourceDigest: JSON.stringify({ fetched: items.length, stored, digest }),
        validationSignalPresent: true,
      },
      select: { eventCommitmentHash: true },
    })
    .catch(() => undefined);

  return { fetched: items.length, stored, llm_used: false };
}

/** Recent stored Moltbook items (for the brain to read/learn + the admin view). */
export async function recentMoltbookItems(limit = 10): Promise<MoltbookItemRecord[]> {
  const rows = await prisma.moltbookItem.findMany({
    orderBy: { seenAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    kind: r.kind,
    title: r.title,
    body: r.body,
    author: r.author,
    sourceUrl: r.sourceUrl,
    // A NULL/absent scan is treated as UNSAFE (fail-closed): only confirmed-clean
    // items may influence prompts. Rows written by persistMoltbookItems always
    // carry a scan; this guards any backfill/legacy writer.
    injectionScan:
      (r.injectionScan as { safe: boolean; matched: string[] } | null) ?? { safe: false, matched: ["unscanned"] },
    trustLevel: "UNKNOWN",
  }));
}

/**
 * Solves the reverse-CAPTCHA (lobster-themed math word problem) using MUSE's
 * cheap model. The challenge is obfuscated text with alternating caps, scattered
 * symbols, and broken words — but the math is simple arithmetic.
 *
 * Returns the answer as a string with 2 decimal places (e.g. "15.00").
 */
async function solveCaptcha(challengeText: string): Promise<string | null> {
  try {
    const response = await brainComplete({
      system:
        "You are a math solver. The input is an obfuscated lobster-themed math word problem with " +
        "alternating caps, scattered symbols (^/[]-), and broken words. Extract the two numbers " +
        "and the operation (+, -, *, /), compute the answer, and return ONLY the number with " +
        "exactly 2 decimal places (e.g. '15.00', '525.00', '-3.50'). No explanation.",
      user: challengeText,
      tier: "cortex",
      model: "gpt-4o-mini",
      temperature: 0.1,
    });
    const cleaned = response.trim().replace(/[^0-9.\-]/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    return num.toFixed(2);
  } catch {
    return null;
  }
}

/**
 * Posts to Moltbook and solves the reverse-CAPTCHA if required. Returns the post
 * ID on success, or null if posting is disabled or the CAPTCHA fails.
 */
export async function postToMoltbook(
  input: { submolt_name: string; title: string; content?: string; url?: string },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; postId: string } | { ok: false; reason: string }> {
  if (!moltbookConfigured()) return { ok: false, reason: "moltbook_not_configured" };
  if (String(process.env.MOLTBOOK_POST_ENABLED || "").toLowerCase() !== "true") {
    return { ok: false, reason: "posting_disabled_set_MOLTBOOK_POST_ENABLED_true" };
  }

  const key = apiKey();
  if (!key) return { ok: false, reason: "no_api_key" };

  try {
    const res = await fetchImpl(`${MOLTBOOK_BASE}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        submolt_name: input.submolt_name,
        title: input.title,
        content: input.content,
        url: input.url,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `post_http_${res.status}:${body.slice(0, 160)}` };
    }

    const data = (await res.json()) as {
      success?: boolean;
      post?: { id?: string; verification_required?: boolean; verification?: { verification_code?: string; challenge_text?: string } };
    };

    if (!data.success || !data.post?.id) {
      return { ok: false, reason: "post_missing_id" };
    }

    // If verification is required, solve the CAPTCHA
    if (data.post.verification_required && data.post.verification?.verification_code) {
      const answer = await solveCaptcha(data.post.verification.challenge_text ?? "");
      if (!answer) {
        return { ok: false, reason: "captcha_solve_failed" };
      }

      const verifyRes = await fetchImpl(`${MOLTBOOK_BASE}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          verification_code: data.post.verification.verification_code,
          answer,
        }),
      });

      if (!verifyRes.ok) {
        return { ok: false, reason: `verify_http_${verifyRes.status}` };
      }

      const verifyData = (await verifyRes.json()) as { success?: boolean };
      if (!verifyData.success) {
        return { ok: false, reason: "verify_failed" };
      }
    }

    return { ok: true, postId: data.post.id };
  } catch (err) {
    return { ok: false, reason: `post_error:${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
  }
}

/**
 * Comments on a post and solves the reverse-CAPTCHA if required.
 */
export async function commentOnMoltbook(
  postId: string,
  content: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; commentId: string } | { ok: false; reason: string }> {
  if (!moltbookConfigured()) return { ok: false, reason: "moltbook_not_configured" };
  if (String(process.env.MOLTBOOK_POST_ENABLED || "").toLowerCase() !== "true") {
    return { ok: false, reason: "posting_disabled" };
  }

  const key = apiKey();
  if (!key) return { ok: false, reason: "no_api_key" };

  try {
    const res = await fetchImpl(`${MOLTBOOK_BASE}/posts/${postId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `comment_http_${res.status}:${body.slice(0, 160)}` };
    }

    const data = (await res.json()) as {
      success?: boolean;
      comment?: { id?: string; verification_required?: boolean; verification?: { verification_code?: string; challenge_text?: string } };
    };

    if (!data.success || !data.comment?.id) {
      return { ok: false, reason: "comment_missing_id" };
    }

    if (data.comment.verification_required && data.comment.verification?.verification_code) {
      const answer = await solveCaptcha(data.comment.verification.challenge_text ?? "");
      if (!answer) return { ok: false, reason: "captcha_solve_failed" };

      const verifyRes = await fetchImpl(`${MOLTBOOK_BASE}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          verification_code: data.comment.verification.verification_code,
          answer,
        }),
      });

      if (!verifyRes.ok) return { ok: false, reason: `verify_http_${verifyRes.status}` };
      // AUDIT FIX (M4): must check the verify BODY, not just HTTP status —
      // otherwise a rejected CAPTCHA is reported as a successful comment.
      const verifyData = (await verifyRes.json().catch(() => ({}))) as { success?: boolean };
      if (verifyData.success !== true) {
        return { ok: false, reason: "verify_failed" };
      }
    }

    return { ok: true, commentId: data.comment.id };
  } catch (err) {
    return { ok: false, reason: `comment_error:${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
  }
}
