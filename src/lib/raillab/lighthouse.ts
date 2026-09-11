/**
 * Adoption Lighthouse (Phase 27).
 *
 * A public, independently-verifiable BAROMETER of organic external adoption: level AND
 * trajectory. Unlike the Trust Console (which answers "is the system safe?"), the Lighthouse
 * answers "is anyone actually using it — and is that growing?".
 *
 * The load-bearing idea is the ORGANIC FILTER: our own smoke harnesses and the adoption proof
 * loop create agents, evidence, receipts, rails and settlements, and counting those as
 * "adoption" would be self-congratulatory. Any row whose identity / evidence / reference
 * carries a marker in `LIGHTHOUSE_MARKERS` is excluded, and the marker list is returned in the
 * response (`excluded_markers`) so the definition is self-describing and auditable.
 *
 * The result is signed with the passport SIGNING_PRIVATE_KEY (the same key as /receipts/monetary)
 * over canonicalJson(body without snapshot) so third parties can verify the numbers offline.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { prisma } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import "@/lib/receipt/crypto";

/** Markers that identify self-generated (non-organic) rows. `adopt-` subsumes `adopt-canary-`. */
export const LIGHTHOUSE_MARKERS = ["adopt-", "adopt-canary-", "smoke:"] as const;

/** Upper bound on rows scanned per table; exceeding it is surfaced as a degraded reason. */
export const LIGHTHOUSE_MAX_SCAN = 100_000;

export type LighthouseBucketKey = "24h" | "7d" | "30d" | "all";
export type TrendDirection = "growing" | "flat" | "falling";

export interface LighthouseBucket {
  enrolled_agents: number;
  evidence_events: number;
  receipts: number;
  settlements: number;
  enabled_rails: number;
  distinct_operator_prefixes: number;
}

export type LighthouseTrend = {
  [K in keyof LighthouseBucket]: TrendDirection;
};

export interface LighthouseMetrics {
  buckets: Record<LighthouseBucketKey, LighthouseBucket>;
  trend: { "24h": LighthouseTrend; "7d": LighthouseTrend };
  excluded_markers: string[];
  organic_only: true;
  generated_at: string;
  degraded: boolean;
  degraded_reasons: string[];
}

export interface LighthouseResponse {
  success: true;
  lighthouse: LighthouseMetrics;
  verify_instructions: string;
  snapshot: {
    content_hash: string;
    signature: string;
    public_key: string;
    algorithm: "ed25519";
  };
}

export const LIGHTHOUSE_VERIFY_INSTRUCTIONS =
  "Recompute content_hash = sha256(canonicalJson(response without `snapshot`, top-level keys sorted)), then verify the ed25519 `signature` over utf8(content_hash) with `public_key`. If it verifies, the adoption numbers were not tampered with.";

const WINDOW_MS: Record<Exclude<LighthouseBucketKey, "all">, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
};

// ── Pure helpers (unit-tested) ──

/** True when a value string carries any self-generated marker. */
export function hasOrganicMarker(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return LIGHTHOUSE_MARKERS.some((m) => value.includes(m));
}

/** True when NONE of the scanned values carry a marker (i.e. the row is organic). */
export function isOrganicRow(values: unknown[]): boolean {
  return !values.some(hasOrganicMarker);
}

/** Two-window delta: current vs equal preceding window. Equal → flat. */
export function classifyTrend(previous: number, current: number): TrendDirection {
  if (current > previous) return "growing";
  if (current < previous) return "falling";
  return "flat";
}

/** Masks an operator id to its first 4 characters (no full id may ever leave the server). */
export function maskOperatorPrefix(operatorId: string): string {
  return operatorId.slice(0, 4);
}

interface MetricRow {
  at: number;
  organic: boolean;
  operatorId?: string | null;
}

/** Counts organic rows within [sinceMs, untilMs), or (sinceMs, untilMs] for windows. */
function countInRange(
  rows: MetricRow[],
  sinceMs: number,
  untilMs: number,
  inclusiveUpper: boolean
): number {
  let n = 0;
  for (const r of rows) {
    if (!r.organic) continue;
    const afterLower = r.at >= sinceMs;
    const beforeUpper = inclusiveUpper ? r.at <= untilMs : r.at < untilMs;
    if (afterLower && beforeUpper) n++;
  }
  return n;
}

function distinctPrefixesInRange(
  rows: MetricRow[],
  sinceMs: number,
  untilMs: number,
  inclusiveUpper: boolean
): number {
  const prefixes = new Set<string>();
  for (const r of rows) {
    if (!r.organic || !r.operatorId) continue;
    const afterLower = r.at >= sinceMs;
    const beforeUpper = inclusiveUpper ? r.at <= untilMs : r.at < untilMs;
    if (afterLower && beforeUpper) prefixes.add(maskOperatorPrefix(r.operatorId));
  }
  return prefixes.size;
}

function bucketStart(window: LighthouseBucketKey, nowMs: number): number {
  if (window === "all") return -Infinity;
  return nowMs - WINDOW_MS[window];
}

export interface LighthouseRowSets {
  agents: MetricRow[];
  evidence: MetricRow[];
  receipts: MetricRow[];
  settlements: MetricRow[];
  rails: MetricRow[];
}

function bucketFor(
  window: LighthouseBucketKey,
  nowMs: number,
  rows: LighthouseRowSets
): LighthouseBucket {
  const since = bucketStart(window, nowMs);
  return {
    enrolled_agents: countInRange(rows.agents, since, nowMs, true),
    evidence_events: countInRange(rows.evidence, since, nowMs, true),
    receipts: countInRange(rows.receipts, since, nowMs, true),
    settlements: countInRange(rows.settlements, since, nowMs, true),
    enabled_rails: countInRange(rows.rails, since, nowMs, true),
    distinct_operator_prefixes: distinctPrefixesInRange(
      [...rows.agents, ...rows.receipts],
      since,
      nowMs,
      true
    ),
  };
}

function trendFor(
  window: Exclude<LighthouseBucketKey, "all">,
  nowMs: number,
  rows: LighthouseRowSets
): LighthouseTrend {
  const span = WINDOW_MS[window];
  const curSince = nowMs - span;
  const prevSince = nowMs - 2 * span;
  const cur = bucketFor(window, nowMs, rows);
  // Preceding equal window is a half-open interval [prevSince, curSince) so a row at the
  // boundary is never counted twice.
  const prev = {
    enrolled_agents: countInRange(rows.agents, prevSince, curSince, false),
    evidence_events: countInRange(rows.evidence, prevSince, curSince, false),
    receipts: countInRange(rows.receipts, prevSince, curSince, false),
    settlements: countInRange(rows.settlements, prevSince, curSince, false),
    enabled_rails: countInRange(rows.rails, prevSince, curSince, false),
    distinct_operator_prefixes: distinctPrefixesInRange(
      [...rows.agents, ...rows.receipts],
      prevSince,
      curSince,
      false
    ),
  };
  return {
    enrolled_agents: classifyTrend(prev.enrolled_agents, cur.enrolled_agents),
    evidence_events: classifyTrend(prev.evidence_events, cur.evidence_events),
    receipts: classifyTrend(prev.receipts, cur.receipts),
    settlements: classifyTrend(prev.settlements, cur.settlements),
    enabled_rails: classifyTrend(prev.enabled_rails, cur.enabled_rails),
    distinct_operator_prefixes: classifyTrend(
      prev.distinct_operator_prefixes,
      cur.distinct_operator_prefixes
    ),
  };
}

/** Pure aggregation over already-fetched rows (the unit-tested core). */
export function computeLighthouse(
  rows: LighthouseRowSets,
  now: Date = new Date(),
  degradedReasons: string[] = []
): LighthouseMetrics {
  const nowMs = now.getTime();
  return {
    buckets: {
      "24h": bucketFor("24h", nowMs, rows),
      "7d": bucketFor("7d", nowMs, rows),
      "30d": bucketFor("30d", nowMs, rows),
      all: bucketFor("all", nowMs, rows),
    },
    trend: {
      "24h": trendFor("24h", nowMs, rows),
      "7d": trendFor("7d", nowMs, rows),
    },
    excluded_markers: [...LIGHTHOUSE_MARKERS],
    organic_only: true,
    generated_at: now.toISOString(),
    degraded: degradedReasons.length > 0,
    degraded_reasons: degradedReasons,
  };
}

// ── Row fetching (degraded-mode per table; one dead feed never hides the rest) ──

async function safeScan<T>(
  table: string,
  fn: () => Promise<T[]>,
  reasons: string[]
): Promise<T[]> {
  try {
    const rows = await fn();
    if (rows.length >= LIGHTHOUSE_MAX_SCAN) {
      reasons.push(`${table}: scan truncated at ${LIGHTHOUSE_MAX_SCAN} rows (counts approximate)`);
    }
    return rows;
  } catch (err) {
    reasons.push(`${table}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function fetchRowSets(reasons: string[]): Promise<LighthouseRowSets> {
  const [agents, evidence, receipts, settlements, specs] = await Promise.all([
    safeScan(
      "agent",
      () =>
        prisma.agent.findMany({
          select: { createdAt: true, agentId: true, domain: true, operatorId: true },
          take: LIGHTHOUSE_MAX_SCAN,
        }),
      reasons
    ),
    safeScan(
      "evidence",
      () =>
        prisma.agentEvidence.findMany({
          select: { createdAt: true, sourceUrl: true, externalTaskId: true, commitSha: true },
          take: LIGHTHOUSE_MAX_SCAN,
        }),
      reasons
    ),
    safeScan(
      "receipt",
      () =>
        prisma.receipt.findMany({
          select: {
            issuedAt: true,
            authorityScope: true,
            agentId: true,
            receiptId: true,
            operatorId: true,
          },
          take: LIGHTHOUSE_MAX_SCAN,
        }),
      reasons
    ),
    safeScan(
      "settlement",
      () =>
        prisma.railSettlement.findMany({
          select: { createdAt: true, railKey: true, reference: true, status: true },
          take: LIGHTHOUSE_MAX_SCAN,
        }),
      reasons
    ),
    safeScan(
      "railSpec",
      () =>
        prisma.railSpec.findMany({
          select: { createdAt: true, railKey: true, name: true, state: true },
          take: LIGHTHOUSE_MAX_SCAN,
        }),
      reasons
    ),
  ]);

  return {
    agents: agents.map((r: any) => ({
      at: r.createdAt.getTime(),
      organic: isOrganicRow([r.agentId, r.domain]),
      operatorId: r.operatorId,
    })),
    evidence: evidence.map((r: any) => ({
      at: r.createdAt.getTime(),
      organic: isOrganicRow([r.sourceUrl, r.externalTaskId, r.commitSha]),
    })),
    receipts: receipts.map((r: any) => ({
      at: r.issuedAt.getTime(),
      organic: isOrganicRow([r.authorityScope, r.agentId, r.receiptId]),
      operatorId: r.operatorId,
    })),
    settlements: settlements.map((r: any) => ({
      at: r.createdAt.getTime(),
      // Only COMPLETED settlements count as adoption. `settle()` persists a row even for a
      // REJECTED (bad-signature) attempt, so counting all rows would let anyone without a
      // signer key inflate the barometer by spamming garbage at /settle.
      organic: r.status === "SETTLED" && isOrganicRow([r.railKey, r.reference]),
    })),
    rails: specs
      .filter((r: any) => r.state === "ENABLED")
      .map((r: any) => ({
        at: r.createdAt.getTime(),
        organic: isOrganicRow([r.railKey, r.name]),
      })),
  };
}

// ── Snapshot signing ──

/**
 * Cache policy for the lighthouse. A SEVERE/degraded reading must never be cached for 5
 * minutes (agents would act on stale data), and the body is ISSUER-gated — so it is `private`
 * (never stored by a shared cache, which would leak gated data to unauthenticated callers).
 */
export function lighthouseCacheControl(degraded: boolean): string {
  return degraded ? "private, no-store, max-age=0" : "private, max-age=300";
}

function signSnapshot(payload: Record<string, unknown>): {
  content_hash: string;
  signature: string;
  public_key: string;
} {
  const contentHash = sha256Hex(canonicalJson(payload));
  const privateKeyHex = process.env.SIGNING_PRIVATE_KEY;
  const hasKey =
    typeof privateKeyHex === "string" &&
    (privateKeyHex.length === 64 || privateKeyHex.length === 128);

  // Fail CLOSED in production: a "signed" barometer that silently emits an empty signature is
  // worse than an error, because consumers would treat unverified numbers as verified.
  if (!hasKey && process.env.NODE_ENV === "production") {
    throw new Error(
      "SIGNING_PRIVATE_KEY is required in production to sign the Adoption Lighthouse snapshot"
    );
  }

  let signature = "";
  if (hasKey) {
    const pk = hexToBytes(
      privateKeyHex!.length === 128 ? privateKeyHex!.slice(0, 64) : privateKeyHex!
    );
    signature = bytesToHex(sign(utf8ToBytes(contentHash), pk));
  }
  let publicKey = "";
  try {
    publicKey = getPublicKeyHex();
  } catch {
    publicKey = "";
  }
  return { content_hash: contentHash, signature, public_key: publicKey };
}

/**
 * Builds the full, signed lighthouse response. Never throws on a DB failure: per-table errors
 * become `degraded_reasons` and the response is still returned (HTTP 200) with what it could see.
 */
export async function buildLighthouse(now: Date = new Date()): Promise<LighthouseResponse> {
  const reasons: string[] = [];
  const rows = await fetchRowSets(reasons);
  const lighthouse = computeLighthouse(rows, now, reasons);

  const signedBody: Record<string, unknown> = {
    success: true,
    lighthouse,
    verify_instructions: LIGHTHOUSE_VERIFY_INSTRUCTIONS,
  };
  const snapshot = signSnapshot(signedBody);

  return {
    success: true,
    lighthouse,
    verify_instructions: LIGHTHOUSE_VERIFY_INSTRUCTIONS,
    snapshot: { ...snapshot, algorithm: "ed25519" },
  };
}
