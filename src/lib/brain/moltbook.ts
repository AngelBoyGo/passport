/**
 * Moltbook integration — the brain reads/learns from the AI-agent forum and can
 * register an agent account.
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
 *
 * Posting is opt-in (MOLTBOOK_POST_ENABLED) and deferred to v1.1: the platform's
 * reverse-CAPTCHA must be solved within a short window or the agent is
 * auto-suspended after 10 misses, so read-only is the safe default.
 *
 * The API key is NEVER logged and NEVER sent anywhere except www.moltbook.com.
 */

import { prisma } from "@/lib/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { scanForPromptInjection } from "@/lib/brain/external-research";

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
    } catch {
      // unique contentHash → already seen; ignore.
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
    injectionScan: (r.injectionScan as { safe: boolean; matched: string[] }) ?? { safe: true, matched: [] },
    trustLevel: "UNKNOWN",
  }));
}
