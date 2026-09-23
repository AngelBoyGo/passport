/**
 * Fleet pay-ranker — the brain's MIRROR of Callora's pay-first ranker.
 *
 * Purpose (owner-approved dual-ranker model): Callora's ranker generates; the
 * brain's ranker VERIFIES. The brain never blindly trusts the hands — on every
 * dispatch it re-ranks the identical payload and asserts AGREEMENT. The shared
 * fixture (fixtures/pay-rank-jobs.json — same file as Callora's
 * tests/fixtures/pay-rank-jobs.json) is the CI floor: both suites must produce
 * the exact expected order or the fixture suite fails in that repo.
 *
 * On runtime disagreement the brain does NOT silently proceed: it trusts its
 * OWN order (the brain is the decision authority), records an ORDER_DRIFT
 * signal for the playbook, and proceeds on its own order. Rank-1 disagreement
 * is a hard signal (never papered over); lower-rank transpositions are
 * tolerated only because equal-rate jobs are legitimately order-unstable.
 *
 * Contract (identical to lib/medical/rank-jobs-by-pay.js):
 *   - QUOTED rate only; unknown-rate jobs excluded (no phantom prices)
 *   - locum filter tolerant of `type` (default-locum) and `job_type`
 *   - sort: pay DESC, match_score DESC, id ASC
 *   - rate floor default $350/hr
 */

export const DEFAULT_PAY_FLOOR = 350;
export const DEFAULT_SHIFT_HOURS = 12; // ER locum typical shift
export const ORDER_VERSION = "pay-v1";

/** Pull a numeric USD amount out of a free-text comp string. */
export function parseCompString(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function isPerDayText(s: unknown): boolean {
  return typeof s === "string" && /day|daily|\/day|per\s*day/i.test(s);
}

/**
 * Normalize any job's pay to HOURLY USD, or null when no rate exists.
 *
 * PARITY + CORRECTNESS NOTE (audit 2026-09-23): `bill_rate_per_day` is
 * deliberately NOT a rate source. It is what the FACILITY is billed (it
 * carries the agency margin), not what the physician is paid — ranking the
 * physician's pay off it overstates earnings. Callora's ranker omits it for
 * the same reason, and the shared fixture locks the parity.
 */
export function hourlyRate(job: Record<string, unknown>): number | null {
  if (!job || typeof job !== "object") return null;

  const explicit = [job.rate_per_hour, job.rate_max, job.physician_rate_usd]
    .map((v) => (typeof v === "number" ? v : parseCompString(v)))
    .find((v) => Number.isFinite(v) && (v as number) > 0) as number | undefined;
  if (explicit) return explicit;

  const compText = parseCompString(job.comp_display);
  if (compText && !isPerDayText(job.comp_display)) return compText;

  const shiftHours =
    typeof job.shift_hours === "number" && job.shift_hours > 0
      ? job.shift_hours
      : DEFAULT_SHIFT_HOURS;
  const dailyRaw =
    typeof job.day_rate === "number" && job.day_rate > 0
      ? job.day_rate
      : compText && isPerDayText(job.comp_display)
        ? compText
        : null;
  if (dailyRaw) return Math.round(dailyRaw / shiftHours);
  if (typeof job.rate_min === "number" && job.rate_type === "day") {
    return Math.round((job.rate_min as number) / shiftHours);
  }

  return null;
}

/** Tolerates the DB-doc key (`id`) and the SERVED payload key (`job_id`). */
export function jobIdOf(job: Record<string, unknown>): string {
  return String(job.id ?? job.job_id ?? "");
}

/** True when the job is a locum/travel role (tolerates both field spellings). */
export function isLocumJob(job: Record<string, unknown>): boolean {
  if (!job || typeof job !== "object") return false;
  if (job.type) {
    const t = String(job.type);
    return /locum|travel/i.test(t) || t.toLowerCase() === "locum";
  }
  if (job.job_type) return /locum|travel/i.test(String(job.job_type));
  return true; // absent = locum (matches employer create default)
}

export interface RankedJob {
  job: Record<string, unknown>;
  rate: number;
  match_score: number;
}

export interface RankResult {
  ranked: RankedJob[];
  excluded: Array<{ job: Record<string, unknown>; reason: string; rate?: number }>;
  floor: number;
}

export function rankJobsByPay(input: {
  jobs: Array<Record<string, unknown>>;
  payFloor?: number;
  matchScore?: (job: Record<string, unknown>) => number;
}): RankResult {
  const floorIn = Number(input.payFloor);
  const floor = Number.isFinite(floorIn) && floorIn > 0 ? floorIn : DEFAULT_PAY_FLOOR;
  const ranked: RankedJob[] = [];
  const excluded: RankResult["excluded"] = [];

  for (const job of input.jobs ?? []) {
    if (!isLocumJob(job)) {
      excluded.push({ job, reason: "not_locum" });
      continue;
    }
    const rate = hourlyRate(job);
    if (rate == null) {
      excluded.push({ job, reason: "no_rate" });
      continue;
    }
    if (rate < floor) {
      excluded.push({ job, reason: "below_floor", rate });
      continue;
    }
    const score =
      typeof input.matchScore === "function" ? Number(input.matchScore(job)) || 0 : 0;
    ranked.push({ job, rate, match_score: score });
  }

  ranked.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;
    return jobIdOf(a.job).localeCompare(jobIdOf(b.job));
  });

  return { ranked, excluded, floor };
}

// ── runtime drift assertion ──────────────────────────────────────────────────

export interface OrderAgreement {
  agree: boolean;
  rank1_match: boolean;
  transpositions: number;
  brain_order: string[];
  callora_order: string[];
}

/**
 * Compares Callora's served order with the brain's own re-ranking of the same
 * payload. Low-rank transpositions between EQUAL-RATE jobs are tolerated
 * (ties are order-unstable); anything else is drift. A LENGTH mismatch is
 * itself drift (shape divergence — the brain missed jobs Callora knows).
 */
export function assertOrderAgreement(
  calloraOrder: string[],
  brainOrder: string[],
  rateOf: (jobId: string) => number | null
): OrderAgreement {
  const rank1 = calloraOrder[0] === brainOrder[0];
  let transpositions = 0;
  for (let i = 0; i < calloraOrder.length; i++) {
    const j = brainOrder.indexOf(calloraOrder[i]);
    if (j < 0) {
      transpositions++; // the brain does not know this job at all — shape drift
      continue;
    }
    // Only count as a real transposition when the two jobs have DIFFERENT
    // rates — equal-rate swaps are ties, not drift.
    const rateA = rateOf(calloraOrder[i]);
    const rateB = rateOf(calloraOrder[j]);
    if (rateA !== rateB) transpositions++;
  }
  for (const id of brainOrder) {
    if (calloraOrder.indexOf(id) < 0) transpositions++;
  }
  return {
    agree: rank1 && transpositions === 0,
    rank1_match: rank1,
    transpositions,
    brain_order: brainOrder,
    callora_order: calloraOrder,
  };
}
