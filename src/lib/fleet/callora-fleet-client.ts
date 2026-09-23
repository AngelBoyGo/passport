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
  ranked: CalloraRankedJob[];
  agreement: { agree: boolean; rank1_match: boolean; transpositions: number };
  order_version: string;
  drift: boolean;
}

/**
 * Fetches Callora's pay-ranked locum jobs for a candidate AND verifies the
 * order with the brain's own ranker over the identical payload. If the two
 * rankers' understanding of the shapes ever diverges (missing entries,
 * different order), it surfaces as agreement.agree=false rather than passing
 * silently.
 */
export async function searchLocumJobs(input: {
  candidateId: string;
  payFloor?: number;
  limit?: number;
}): Promise<LocumSearchResult> {
  const res = await callCallora("/api/fleet/locum-search", {
    candidate_id: input.candidateId,
    pay_floor: input.payFloor,
    limit: input.limit ?? 25,
  });

  const ranked = (res.ranked as CalloraRankedJob[] | undefined) ?? [];
  const servedVersion = String(res.order_version ?? "");
  if (servedVersion && servedVersion !== ORDER_VERSION) {
    throw new Error(`order_version_mismatch:${servedVersion}`);
  }

  // Re-rank the identical payload with the brain's own implementation.
  const reRank = rankJobsByPay({
    jobs: ranked as unknown as Array<Record<string, unknown>>,
    payFloor: input.payFloor,
  });
  const brainOrder = reRank.ranked.map((r) => jobIdOf(r.job));
  const servedOrder = ranked.map((r) => r.job_id);
  const agreement = assertOrderAgreement(servedOrder, brainOrder, (id) => {
    const row = ranked.find((r) => r.job_id === id);
    return row?.rate_usd_hourly ?? reRank.ranked.find((r) => jobIdOf(r.job) === id)?.rate ?? null;
  });

  return {
    ranked,
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
