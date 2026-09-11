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

import { signReportPayload } from "./report-signing";
import {
  LIGHTHOUSE_MARKERS,
  LIGHTHOUSE_MAX_SCAN,
  hasOrganicMarker,
  isOrganicRow,
  fetchPersistenceRows,
  buildPersistence,
  type PersistenceBlock,
  type PersistenceRowSets,
} from "./persistence";

// Re-exported so existing consumers/tests keep importing the organic filter from the Lighthouse.
export { LIGHTHOUSE_MARKERS, LIGHTHOUSE_MAX_SCAN, hasOrganicMarker, isOrganicRow };

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
  persistence: PersistenceBlock;
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

function emptyFunnel() {
  return { enrolled: 0, evidenced: 0, receipted: 0, settled: 0, returned: 0 };
}

/** Empty persistence block — used by the pure core when no attribution rows are supplied. */
function emptyPersistence(): PersistenceBlock {
  return {
    cohorts: [],
    funnel: { "7d": emptyFunnel(), "30d": emptyFunnel(), all: emptyFunnel() },
    integrity: { suspicious: false, reasons: [] },
  };
}

/** Pure aggregation over already-fetched rows (the unit-tested core). */
export function computeLighthouse(
  rows: LighthouseRowSets,
  now: Date = new Date(),
  degradedReasons: string[] = [],
  persistence: PersistenceBlock = emptyPersistence()
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
    persistence,
    excluded_markers: [...LIGHTHOUSE_MARKERS],
    organic_only: true,
    generated_at: now.toISOString(),
    degraded: degradedReasons.length > 0,
    degraded_reasons: degradedReasons,
  };
}

// ── Metric-row projection (the Lighthouse reuses the Phase-28 persisted fetch) ──

function toMetricRows(rows: PersistenceRowSets): LighthouseRowSets {
  return {
    agents: rows.agents.map((r) => ({ at: r.at, organic: r.organic, operatorId: r.operatorId })),
    evidence: rows.evidence.map((r) => ({ at: r.at, organic: r.organic })),
    receipts: rows.receipts.map((r) => ({
      at: r.at,
      organic: r.organic,
      operatorId: r.operatorId,
    })),
    settlements: rows.settlements.map((r) => ({ at: r.at, organic: r.organic })),
    // `enabled_rails` is an ENABLED-only metric, but `fetchPersistenceRows` returns ALL rails so
    // persistence can attribute settlements on rails that were later quarantined/retired.
    rails: rows.rails.map((r) => ({ at: r.at, organic: r.organic && r.state === "ENABLED" })),
  };
}

// ── Snapshot signing ──

/**
 * Cache policy for the lighthouse. A degraded reading OR a suspected-inflation reading must
 * never be cached for 5 minutes (agents would act on stale/misleading data), and the body is
 * ISSUER-gated — so it is `private` (never stored by a shared cache, which would leak gated
 * data to unauthenticated callers).
 */
export function lighthouseCacheControl(degraded: boolean, suspicious = false): string {
  return degraded || suspicious ? "private, no-store, max-age=0" : "private, max-age=300";
}

/**
 * Builds the full, signed lighthouse response. Never throws on a DB failure: per-table errors
 * become `degraded_reasons` and the response is still returned (HTTP 200) with what it could see.
 */
export async function buildLighthouse(now: Date = new Date()): Promise<LighthouseResponse> {
  const reasons: string[] = [];
  const pRows = await fetchPersistenceRows(reasons);
  const metricRows = toMetricRows(pRows);
  const persistence = buildPersistence(pRows, now);
  const lighthouse = computeLighthouse(metricRows, now, reasons, persistence);

  const signedBody: Record<string, unknown> = {
    success: true,
    lighthouse,
    verify_instructions: LIGHTHOUSE_VERIFY_INSTRUCTIONS,
  };
  const snapshot = signReportPayload(signedBody);

  return {
    success: true,
    lighthouse,
    verify_instructions: LIGHTHOUSE_VERIFY_INSTRUCTIONS,
    snapshot: { ...snapshot, algorithm: "ed25519" },
  };
}
