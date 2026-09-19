/**
 * External research scan (Phase 42) — the brain researches the outside world.
 *
 * Complements the internal self-research scan: this module asks the LLM for
 * external observations relevant to the Passport economy (regulation, market
 * structure, compute economics, commodity flows, Sahel corridor developments)
 * and persists them as evidence with STRICT provenance:
 *
 *   - trust level per item: LLM_PRIOR (model knowledge, no source claimed) or
 *     UNKNOWN (a source URL is claimed but was never fetched/verified).
 *     VERIFIED_SOURCE is reserved for a future live fetcher — never set here.
 *   - contentHash: sha256 over the canonical item content, so duplicates and
 *     tampering are detectable.
 *   - prompt-injection scan: every item's text passes a pattern scan before
 *     persistence; matched patterns are recorded, never stripped silently.
 *
 * Read-only by design: findings enter memory as evidence and never execute.
 * Without a configured web-search provider this is honestly labeled LLM-prior
 * research, not live web search.
 */

import { prisma } from "@/lib/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { brainComplete, parseJsonObject } from "@/lib/raillab/factory-brain";

export type ResearchTrustLevel = "VERIFIED_SOURCE" | "LLM_PRIOR" | "UNKNOWN";

export interface ExternalResearchItem {
  title: string;
  category: string;
  summary: string;
  /** Claimed source URL — recorded but NEVER trusted without a live fetch. */
  source_url: string | null;
  trust_level: ResearchTrustLevel;
  content_hash: string;
  injection_scan: { safe: boolean; matched: string[] };
  confidence: number;
  suggested_action: string | null;
}

export interface ExternalResearchScanResult {
  scanId: string;
  items: ExternalResearchItem[];
  llm_used: boolean;
}

export interface ExternalResearchDeps {
  complete?: typeof brainComplete;
  now?: () => Date;
}

const ITEM_CAP = 10;
const CONFIDENCE_CATEGORIES = new Set([
  "regulation", "market", "compute", "commodity", "sahel_corridor", "platform", "other",
]);

/** sha256 hex over UTF-8 content — stable across runs for identical content. */
export function hashResearchContent(content: string): string {
  return bytesToHex(sha256(utf8ToBytes(content)));
}

/**
 * First-pass prompt-injection scan over untrusted external text. Deliberately
 * pattern-based and explainable: it records WHAT matched so humans can audit
 * the filter itself. Never mutates the text — matching items are persisted with
 * injection_scan.safe=false for downstream trust weighting.
 */
const INJECTION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "override_instructions", re: /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b/i },
  { id: "disregard_rules", re: /\bdisregard\s+(your\s+)?(instructions|rules|guardrails)\b/i },
  { id: "role_hijack", re: /\byou\s+are\s+now\b/i },
  { id: "reveal_prompt", re: /\b(reveal|show|print|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions)\b/i },
  { id: "new_directive", re: /\bnew\s+instructions\s*:/i },
  { id: "safety_override", re: /\boverride\s+(your\s+)?(safety|rules|policy)/i },
  { id: "tag_spoof", re: /<\/?(system|assistant|developer)\s*>/i },
  { id: "exfiltrate", re: /\b(exfiltrate|send\s+me|forward)\s+.{0,40}(keys?|secrets?|credentials?|env\b)/i },
];

export function scanForPromptInjection(text: string): { safe: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const { id, re } of INJECTION_PATTERNS) {
    if (re.test(text)) matched.push(id);
  }
  return { safe: matched.length === 0, matched };
}

/** Canonical item content for hashing (all fields that define the claim). */
function canonicalItemContent(item: {
  title: string;
  category: string;
  summary: string;
  source_url: string | null;
  suggested_action: string | null;
}): string {
  return JSON.stringify({
    title: item.title,
    category: item.category,
    summary: item.summary,
    source_url: item.source_url,
    suggested_action: item.suggested_action,
  });
}

/** Coerces raw LLM output into typed, hashed, injection-scanned items. */
export function parseExternalResearch(
  raw: Record<string, unknown>
): ExternalResearchItem[] {
  const items: ExternalResearchItem[] = [];
  const rawItems = Array.isArray(raw.items) ? raw.items : [];

  for (const entry of rawItems.slice(0, ITEM_CAP)) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const title = String(obj.title ?? "").trim();
    const summary = String(obj.summary ?? "").trim();
    if (!title || !summary) continue;

    const categoryRaw = String(obj.category ?? "other").toLowerCase();
    const category = CONFIDENCE_CATEGORIES.has(categoryRaw) ? categoryRaw : "other";

    const urlRaw = String(obj.source_url ?? "").trim();
    let sourceUrl: string | null = null;
    try {
      const parsedUrl = new URL(urlRaw);
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        sourceUrl = parsedUrl.toString().slice(0, 500);
      }
    } catch {
      sourceUrl = null;
    }

    // Honest trust assignment: a claimed URL was never fetched; model knowledge
    // is prior knowledge. VERIFIED_SOURCE requires a live fetch (not available here).
    const trustLevel: ResearchTrustLevel = sourceUrl ? "UNKNOWN" : "LLM_PRIOR";

    const suggestedActionRaw = String(obj.suggested_action ?? "").trim();
    const suggestedAction = suggestedActionRaw ? suggestedActionRaw.slice(0, 300) : null;

    const item = {
      title: title.slice(0, 200),
      category,
      summary: summary.slice(0, 1000),
      source_url: sourceUrl,
      trust_level: trustLevel,
      content_hash: "",
      injection_scan: scanForPromptInjection(`${title}\n${summary}\n${suggestedAction ?? ""}`),
      confidence: clampConfidence(Number(obj.confidence)),
      suggested_action: suggestedAction,
    };
    item.content_hash = hashResearchContent(canonicalItemContent(item));
    items.push(item);
  }

  return items;
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0.3;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

/**
 * Runs one external research scan. Never throws — on LLM failure returns
 * llm_used=false with an empty item list (fail-open for READ-ONLY research).
 * Persists the scan as a single evidence row under the excluded internal
 * identity "command-brain" (never counts toward public agent rankings).
 */
export async function runExternalResearchScan(
  now: Date = new Date(),
  deps: ExternalResearchDeps = {},
  focus?: string
): Promise<ExternalResearchScanResult> {
  const scanId = `extscan_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const complete = deps.complete ?? brainComplete;

  let items: ExternalResearchItem[] = [];
  let llmUsed = false;

  try {
    const raw = await complete({
      system:
        "You are the Passport ASMC-3 Command Brain's external-research module. " +
        "Survey the OUTSIDE world for developments relevant to a commodity-backed " +
        "autonomous-agent economy (AngelCoin, evidence-verified agents, settlement rails, " +
        "Sahel corridor trade): regulation, market structure, compute economics, commodity " +
        "flows, platform shifts. Report only what you are confident is real from your " +
        "knowledge; mark items with a source URL only if you can name one, and set " +
        "confidence low when uncertain. Return STRICT JSON: " +
        '{"items": [{"title": str, "category": "regulation"|"market"|"compute"|"commodity"|"sahel_corridor"|"platform"|"other", ' +
        '"summary": str, "source_url": str|null, "confidence": float 0..1, "suggested_action": str|null}]}. ' +
        "No prose outside the JSON object.",
      user: JSON.stringify({ scan_id: scanId, focus: focus ?? null }),
      json: true,
      temperature: 0.3,
    });
    items = parseExternalResearch(parseJsonObject(raw));
    llmUsed = true;
  } catch {
    // Fail-open for read-only research — the empty scan is still recorded.
  }

  try {
    await prisma.agentEvidence.create({
      data: {
        sourceType: "brain_external_research",
        artifactType: "report",
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: now,
        agentIdentityCommitment: "command-brain",
        eventCommitmentHash: `${scanId}_${Math.random().toString(36).slice(2, 8)}`,
        sourceDigest: JSON.stringify({ scan_id: scanId, items, llm_used: llmUsed }).slice(0, 10_000),
        validationSignalPresent: llmUsed,
      },
    });
  } catch {
    // Non-fatal: scan result is still returned to the caller.
  }

  return { scanId, items, llm_used: llmUsed };
}
