/**
 * Passport -> Callora capability client (the brain reaching the hands).
 *
 * Mirrors the existing Callora->Passport direction (calloraMedora's
 * lib/passport-client.js) so the loop is bidirectional:
 *
 *   Callora (hands)                      Passport (brain)
 *   ────────────────────────────         ─────────────────────────────
 *   postCallEvidence / billMinutes  <==  THIS client (locum-search/-play)
 *   hire-transcript-parser          <==  fleet dispatch (engagement escrow)
 *
 * Auth: Callora's cron-secret (the one machine secret its /api/cron/* ticks
 * already accept — one machine secret, as approved). Every response shape is
 * validated; a Callora outage or contract change FAILS the call rather than
 * passing garbage into the brain.
 *
 * Anti-drift: searchLocumJobs() re-ranks the served payload with the brain's
 * OWN ranker and asserts agreement. On drift the brain TRUSTS ITS OWN ORDER and
 * reports the mismatch (agreement + drift flag) so the playbook sees it next
 * cycle. Rank-1 disagreement is always reported.
 */

import {
  assertOrderAgreement,
  jobIdOf,
  ORDER_VERSION,
  rankJobsByPay,
} from "./pay-ranker";

/** Read lazily: vitest/deploys may set env after module load. */
function baseUrl(): string {
  return (
    process.env.CALLORA_FLEET_BASE_URL ||
    process.env.CALLORA_API_BASE_URL ||
    ""
  ).replace(/\/+$/, "");
}

function calloraSecret(): string {
  return process.env.CALLORA_FLEET_CRON_SECRET || process.env.CRON_SECRET || "";
}

export function calloraClientConfigured(): boolean {
  return Boolean(baseUrl() && calloraSecret());
}

async function callCallora(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 20000
): Promise<Record<string, unknown>> {
  if (!calloraClientConfigured()) {
    throw new Error("callora_not_configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": calloraSecret(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`callora_${res.status}:${txt.slice(0, 160)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ── public API ───────────────────────────────────────────────────────────────

export interface CalloraRankedJob {
  job_id: string;
  title: string | null;
  specialty: string | null;
  state: string | null;
  rate_usd_hourly: number;
  match_score: number;
  facility: string | null;
  // Rate fields the brain needs to re-rank the identical serving:
  type?: string | null;
  job_type?: string | null;
  rate_per_hour?: number | null;
  rate_max?: number | null;
  physician_rate_usd?: number | null;
  comp_display?: string | null;
  day_rate?: number | null;
  bill_rate_per_day?: number | null;
  rate_min?: number | null;
  rate_type?: string | null;
  shift_hours?: number | null;
}

export interface LocumSearchResult {
  /** The BRAIN's own pay-ordered jobs — the authoritative list callers must use. */
  ranked: CalloraRankedJob[];
  /** Exactly what Callora served, for observability/drift inspection. */
  served_ranked: CalloraRankedJob[];
  served_order: string[];
  brain_order: string[];
  agreement: { agree: boolean; rank1_match: boolean; transpositions: number };
  order_version: string;
  drift: boolean;
}

/**
 * Fetches Callora's pay-ranked locum jobs for a candidate AND verifies the
 * order with the brain's own ranker over the identical payload.
 *
 * The returned `ranked` list is ALWAYS the brain's own order (the documented
 * invariant: on disagreement the brain trusts its own judgment). Callora's
 * exact serving is preserved in `served_ranked`/`served_order` for audit. Any
 * job the brain cannot rate (unknown shape) drops out of the brain list —
 * never pursued at a phantom price — and shows up as drift.
 */
export async function searchLocumJobs(input: {
  candidateId?: string;
  candidateName?: string;
  payFloor?: number;
  limit?: number;
}): Promise<LocumSearchResult> {
  const res = await callCallora("/api/fleet/locum-search", {
    ...(input.candidateId ? { candidate_id: input.candidateId } : {}),
    ...(input.candidateName ? { candidate_name: input.candidateName } : {}),
    pay_floor: input.payFloor,
    limit: input.limit ?? 25,
  });

  // Garbage-shape guard: a non-array `ranked` must never crash the brain.
  const served = Array.isArray(res.ranked) ? (res.ranked as CalloraRankedJob[]) : [];
  const servedVersion = String(res.order_version ?? "");
  if (servedVersion && servedVersion !== ORDER_VERSION) {
    throw new Error(`order_version_mismatch:${servedVersion}`);
  }

  // Re-rank the identical payload with the brain's own implementation.
  const reRank = rankJobsByPay({
    jobs: served as unknown as Array<Record<string, unknown>>,
    payFloor: input.payFloor,
  });
  const byId = new Map(served.map((r) => [String(r.job_id), r]));
  const brainOrder = reRank.ranked.map((r) => jobIdOf(r.job));
  // `ranked` = brain order, enriched with Callora's rows (its own order wins).
  const ranked = brainOrder
    .map((id) => byId.get(id))
    .filter((r): r is CalloraRankedJob => Boolean(r));

  const servedOrder = served.map((r) => String(r.job_id));
  const agreement = assertOrderAgreement(servedOrder, brainOrder, (id) => {
    const row = served.find((r) => String(r.job_id) === id);
    return row?.rate_usd_hourly ?? reRank.ranked.find((r) => jobIdOf(r.job) === id)?.rate ?? null;
  });

  return {
    ranked,
    served_ranked: served,
    served_order: servedOrder,
    brain_order: brainOrder,
    agreement: {
      agree: agreement.agree,
      rank1_match: agreement.rank1_match,
      transpositions: agreement.transpositions,
    },
    order_version: servedVersion || ORDER_VERSION,
    drift: !agreement.agree,
  };
}

/** Queues the existing Callora outreach planner (A1: no parallel senders). */
export async function playLocumJobs(input: {
  candidateId: string;
  jobIds: string[];
}): Promise<Record<string, unknown>> {
  return callCallora("/api/fleet/locum-play", {
    candidate_id: input.candidateId,
    job_ids: input.jobIds,
    play: "outreach",
  });
}
