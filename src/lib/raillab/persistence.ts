/**
 * Proof of Persistence (Phase 28).
 *
 * The Adoption Lighthouse (Phase 27) measures FLOW — how many showed up. Flow is vanity and is
 * trivially inflatable: anyone can mint marker-free agents and evidence. Persistence measures
 * whether participants CAME BACK and kept doing costly, hard-to-fake work. It is the difference
 * between "we got signups" and "we have a network".
 *
 * Three signals, all signed together with the Phase-27 metrics:
 *   - cohorts:    ISO-week groups of newly-seen organic operators, with w1/w2/w3 retention.
 *   - funnel:     enrolled -> evidenced -> receipted -> settled -> returned (nested subsets).
 *   - integrity:  inflation flags (enroll-and-vanish, never-settled ratio).
 *
 * Attribution: an operator owns agents and receipts directly; evidence is attributed via the
 * agent it was posted for; a settlement is attributed via the operator that authorized its rail.
 * Settlements count only when SETTLED (a valid signer signature), so the strongest persistence
 * signal cannot be manufactured without a rail signer key.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";

/** Markers that identify self-generated (non-organic) rows. `adopt-` subsumes `adopt-canary-`. */
export const LIGHTHOUSE_MARKERS = ["adopt-", "adopt-canary-", "smoke:"] as const;

/** Upper bound on rows scanned per table; exceeding it is surfaced as a degraded reason. */
export const LIGHTHOUSE_MAX_SCAN = 100_000;

/** Number of trailing ISO weeks shown as cohorts. */
export const PERSISTENCE_COHORT_WEEKS = 8;

/** Inflation thresholds (exported so the definition is testable + auditable). */
export const INFLATION_SETTLED_RATIO_THRESHOLD = 0.8;
export const INFLATION_MIN_SAMPLE = 10;
export const INFLATION_MIN_COHORT_SIZE = 10;
export const INFLATION_LOW_RETENTION_THRESHOLD = 0.1;
/**
 * Grace before a new operator is eligible for the never-settled ratio. Settlement requires an
 * ENABLED rail the operator authorized, which takes time to provision — judging operators the
 * day they appear would mark every growing network as manufactured.
 */
export const INFLATION_SETTLEMENT_GRACE_MS = 3 * 24 * 3600_000;

const WEEK_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

// ── Organic filter (shared with the Lighthouse; re-exported there) ──

/** True when a value string carries any self-generated marker. */
export function hasOrganicMarker(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return LIGHTHOUSE_MARKERS.some((m) => value.includes(m));
}

/** True when NONE of the scanned values carry a marker (i.e. the row is organic). */
export function isOrganicRow(values: unknown[]): boolean {
  return !values.some(hasOrganicMarker);
}

// ── ISO week helpers (UTC) ──

/** Monday 00:00:00 UTC of the ISO week containing `date`. */
export function weekStartMs(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d.getTime();
}

/** ISO-8601 week parts (year + week) for a UTC date. */
export function isoWeekParts(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday determines the ISO year
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return { year, week };
}

/** ISO-8601 label, e.g. "2026-W24". */
export function isoWeekKey(date: Date): string {
  const { year, week } = isoWeekParts(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ── Row shapes ──

export interface PersistenceAgentRow {
  at: number;
  organic: boolean;
  agentId: string | null;
  operatorId: string | null;
}
export interface PersistenceEvidenceRow {
  at: number;
  organic: boolean;
  agentIdentityCommitment: string | null;
}
export interface PersistenceReceiptRow {
  at: number;
  organic: boolean;
  operatorId: string | null;
}
export interface PersistenceSettlementRow {
  at: number;
  organic: boolean;
  railKey: string;
}
export interface PersistenceRailRow {
  at: number;
  organic: boolean;
  railKey: string;
  authorizedBy: string | null;
  /** Current rail state. Attribution uses ALL rails; the Lighthouse metric counts only ENABLED. */
  state: string;
}

export interface PersistenceRowSets {
  agents: PersistenceAgentRow[];
  evidence: PersistenceEvidenceRow[];
  receipts: PersistenceReceiptRow[];
  settlements: PersistenceSettlementRow[];
  rails: PersistenceRailRow[];
}

export type ActivityKind = "agent" | "receipt" | "evidence" | "settled";

export interface OperatorEvent {
  operatorId: string;
  at: number;
  kind: ActivityKind;
}

// ── Derivation: attribute every event to an operator ──

export interface OperatorModel {
  events: OperatorEvent[];
  firstSeen: Map<string, number>;
  activityWeeks: Map<string, Set<number>>;
  eventsByOperator: Map<string, OperatorEvent[]>;
}

/**
 * Builds the operator model: attributes evidence via the owning agent and settlements via the
 * authorizing operator of their rail. Rows with no attribution are dropped from persistence
 * (they still count in the Phase-27 flow buckets).
 */
export function deriveOperatorModel(rows: PersistenceRowSets): OperatorModel {
  const agentToOperator = new Map<string, string>();
  for (const a of rows.agents) {
    if (a.organic && a.agentId && a.operatorId) agentToOperator.set(a.agentId, a.operatorId);
  }
  const railToOperator = new Map<string, string>();
  for (const r of rows.rails) {
    if (r.organic && r.railKey && r.authorizedBy) railToOperator.set(r.railKey, r.authorizedBy);
  }

  const events: OperatorEvent[] = [];
  for (const a of rows.agents) {
    if (a.organic && a.operatorId) events.push({ operatorId: a.operatorId, at: a.at, kind: "agent" });
  }
  for (const r of rows.receipts) {
    if (r.organic && r.operatorId) events.push({ operatorId: r.operatorId, at: r.at, kind: "receipt" });
  }
  for (const e of rows.evidence) {
    if (!e.organic || !e.agentIdentityCommitment) continue;
    const op = agentToOperator.get(e.agentIdentityCommitment);
    if (op) events.push({ operatorId: op, at: e.at, kind: "evidence" });
  }
  for (const s of rows.settlements) {
    if (!s.organic) continue;
    const op = railToOperator.get(s.railKey);
    if (op) events.push({ operatorId: op, at: s.at, kind: "settled" });
  }

  const firstSeen = new Map<string, number>();
  const activityWeeks = new Map<string, Set<number>>();
  const eventsByOperator = new Map<string, OperatorEvent[]>();

  for (const ev of events) {
    const list = eventsByOperator.get(ev.operatorId) ?? [];
    list.push(ev);
    eventsByOperator.set(ev.operatorId, list);

    const wk = weekStartMs(new Date(ev.at));
    const weeks = activityWeeks.get(ev.operatorId) ?? new Set<number>();
    weeks.add(wk);
    activityWeeks.set(ev.operatorId, weeks);

    // Cohort = the operator's first Agent OR Receipt (not evidence/settlement).
    if (ev.kind === "agent" || ev.kind === "receipt") {
      const prev = firstSeen.get(ev.operatorId);
      if (prev === undefined || ev.at < prev) firstSeen.set(ev.operatorId, ev.at);
    }
  }

  return { events, firstSeen, activityWeeks, eventsByOperator };
}

// ── Cohorts ──

export interface PersistenceCohort {
  week: string;
  size: number;
  w1_retention: number;
  w2_retention: number;
  w3_retention: number;
  /**
   * True once the week-1 retention window has fully elapsed (`start + 2 weeks <= now`). The most
   * recent cohorts are immature: their w1 value is structurally 0 because the window has not
   * happened yet, so integrity checks must ignore them (otherwise a growing network is flagged
   * "enroll-and-vanish" the moment it gains 10 operators).
   */
  mature: boolean;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Weekly cohorts (last `PERSISTENCE_COHORT_WEEKS` ISO weeks) with w1/w2/w3 retention. */
export function computePersistence(rows: PersistenceRowSets, now: Date): PersistenceCohort[] {
  const { firstSeen, activityWeeks } = deriveOperatorModel(rows);
  const nowWeek = weekStartMs(now);

  const cohorts: PersistenceCohort[] = [];
  for (let i = PERSISTENCE_COHORT_WEEKS - 1; i >= 0; i--) {
    const start = nowWeek - i * WEEK_MS;
    const members: string[] = [];
    for (const [op, at] of firstSeen) {
      if (weekStartMs(new Date(at)) === start) members.push(op);
    }
    const retention = (k: number): number => {
      if (members.length === 0) return 0;
      const target = start + k * WEEK_MS;
      const active = members.filter((op) => activityWeeks.get(op)?.has(target)).length;
      return round3(active / members.length);
    };
    cohorts.push({
      week: isoWeekKey(new Date(start)),
      size: members.length,
      w1_retention: retention(1),
      w2_retention: retention(2),
      w3_retention: retention(3),
      // The week-1 window [start+1w, start+2w) is fully elapsed only when start+2w <= nowWeek.
      mature: start + 2 * WEEK_MS <= nowWeek,
    });
  }
  return cohorts;
}

// ── Funnel ──

export interface PersistenceFunnel {
  enrolled: number;
  evidenced: number;
  receipted: number;
  settled: number;
  returned: number;
}

/**
 * The operator funnel for a window. Stages are NESTED subsets (each requires all prior stages),
 * which makes the funnel monotonic non-increasing by construction — the shape an honest funnel
 * must have. `returned` additionally requires activity in a week AFTER the operator's cohort.
 */
export function computeFunnel(
  rows: PersistenceRowSets,
  now: Date,
  windowMs: number | null
): PersistenceFunnel {
  const { firstSeen, activityWeeks, eventsByOperator } = deriveOperatorModel(rows);
  const nowMs = now.getTime();
  const since = windowMs === null ? -Infinity : nowMs - windowMs;

  const hasInWindow = (op: string, kind: ActivityKind): boolean =>
    (eventsByOperator.get(op) ?? []).some((e) => e.kind === kind && e.at >= since && e.at <= nowMs);

  const activeInLaterWeek = (op: string): boolean => {
    const cohortWeek = weekStartMs(new Date(firstSeen.get(op) as number));
    const weeks = activityWeeks.get(op);
    if (!weeks) return false;
    for (const w of weeks) if (w > cohortWeek) return true;
    return false;
  };

  const enrolled = new Set<string>();
  for (const [op, at] of firstSeen) {
    if (at >= since && at <= nowMs) enrolled.add(op);
  }
  const evidenced = new Set([...enrolled].filter((op) => hasInWindow(op, "evidence")));
  const receipted = new Set([...evidenced].filter((op) => hasInWindow(op, "receipt")));
  const settled = new Set([...receipted].filter((op) => hasInWindow(op, "settled")));
  const returned = new Set([...settled].filter(activeInLaterWeek));

  return {
    enrolled: enrolled.size,
    evidenced: evidenced.size,
    receipted: receipted.size,
    settled: settled.size,
    returned: returned.size,
  };
}

// ── Inflation detection ──

export interface InflationReport {
  suspicious: boolean;
  reasons: string[];
}

/**
 * Flags manufactured adoption:
 *   - enroll-and-vanish: a MATURE cohort (size >= MIN_COHORT_SIZE) with < 10% week-1 retention;
 *   - never-settled ratio: over 7d, > 80% of newly-seen operators (past a 3-day grace) never
 *     produced a SETTLED settlement (with a minimum sample so tiny networks are not libelled).
 */
export function detectInflation(rows: PersistenceRowSets, now: Date): InflationReport {
  const { firstSeen, eventsByOperator } = deriveOperatorModel(rows);
  const reasons: string[] = [];
  const nowMs = now.getTime();

  const everSettled = new Set<string>();
  for (const [op, evs] of eventsByOperator) {
    if (evs.some((e) => e.kind === "settled")) everSettled.add(op);
  }

  const since7 = nowMs - 7 * DAY_MS;
  // Only operators that have had the grace period to provision a rail + settle are eligible.
  const eligibleCutoff = nowMs - INFLATION_SETTLEMENT_GRACE_MS;
  const enrolled7 = [...firstSeen.entries()]
    .filter(([, at]) => at >= since7 && at <= eligibleCutoff)
    .map(([op]) => op);

  if (enrolled7.length >= INFLATION_MIN_SAMPLE) {
    const neverSettled = enrolled7.filter((op) => !everSettled.has(op)).length;
    const ratio = neverSettled / enrolled7.length;
    if (ratio > INFLATION_SETTLED_RATIO_THRESHOLD) {
      reasons.push(
        `never-settled ratio ${round3(ratio)} over 7d exceeds ${INFLATION_SETTLED_RATIO_THRESHOLD} (${neverSettled}/${enrolled7.length} new operators never settled)`
      );
    }
  }

  for (const cohort of computePersistence(rows, now)) {
    // Only mature cohorts have a meaningful w1 window; the current/previous cohorts would
    // otherwise read w1=0 by construction and libel a growing network.
    if (
      cohort.mature &&
      cohort.size >= INFLATION_MIN_COHORT_SIZE &&
      cohort.w1_retention < INFLATION_LOW_RETENTION_THRESHOLD
    ) {
      reasons.push(
        `enroll-and-vanish: cohort ${cohort.week} (size ${cohort.size}) has w1_retention ${cohort.w1_retention} < ${INFLATION_LOW_RETENTION_THRESHOLD}`
      );
    }
  }

  return { suspicious: reasons.length > 0, reasons };
}

// ── Aggregate block ──

export interface PersistenceBlock {
  cohorts: PersistenceCohort[];
  funnel: { "7d": PersistenceFunnel; "30d": PersistenceFunnel; all: PersistenceFunnel };
  integrity: InflationReport;
}

export function buildPersistence(rows: PersistenceRowSets, now: Date): PersistenceBlock {
  return {
    cohorts: computePersistence(rows, now),
    funnel: {
      "7d": computeFunnel(rows, now, 7 * DAY_MS),
      "30d": computeFunnel(rows, now, 30 * DAY_MS),
      all: computeFunnel(rows, now, null),
    },
    integrity: detectInflation(rows, now),
  };
}

// ── Row fetching (degraded per table) ──

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

/** Fetches every table the Lighthouse + Persistence need, with attribution fields. */
export async function fetchPersistenceRows(reasons: string[]): Promise<PersistenceRowSets> {
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
          select: {
            createdAt: true,
            sourceUrl: true,
            externalTaskId: true,
            commitSha: true,
            agentIdentityCommitment: true,
          },
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
          select: { createdAt: true, railKey: true, name: true, state: true, authorizedBy: true },
          take: LIGHTHOUSE_MAX_SCAN,
        }),
      reasons
    ),
  ]);

  return {
    agents: agents.map((r: any) => ({
      at: r.createdAt.getTime(),
      organic: isOrganicRow([r.agentId, r.domain]),
      agentId: r.agentId ?? null,
      operatorId: r.operatorId ?? null,
    })),
    evidence: evidence.map((r: any) => ({
      at: r.createdAt.getTime(),
      organic: isOrganicRow([r.sourceUrl, r.externalTaskId, r.commitSha]),
      agentIdentityCommitment: r.agentIdentityCommitment ?? null,
    })),
    receipts: receipts.map((r: any) => ({
      at: r.issuedAt.getTime(),
      organic: isOrganicRow([r.authorityScope, r.agentId, r.receiptId]),
      operatorId: r.operatorId ?? null,
    })),
    settlements: settlements.map((r: any) => ({
      at: r.createdAt.getTime(),
      // Only COMPLETED settlements count — a REJECTED bad-signature row is free to spam.
      organic: r.status === "SETTLED" && isOrganicRow([r.railKey, r.reference]),
      railKey: r.railKey,
    })),
    rails: specs.map((r: any) => ({
      at: r.createdAt.getTime(),
      organic: isOrganicRow([r.railKey, r.name]),
      railKey: r.railKey,
      authorizedBy: r.authorizedBy ?? null,
      state: r.state,
    })),
  };
}
