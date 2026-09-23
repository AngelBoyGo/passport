/**
 * Capability: locum_job_search — the fleet's first REAL earner capability.
 *
 * A1 orchestration contract: the brain's agent calls Callora's capability
 * endpoints; it never sources jobs itself and never sends outreach itself.
 * Callora remains the sole outreach system; the agent drives it, verifies its
 * ranking, and reports results back as the brain's decision-space.
 *
 * Safety model already inherited from Phases 2-4:
 *   - the capability runs only when the fleet is not halted (FLEET_HALT),
 *   - an explicit capability switch (FLEET_CAPABILITY_LOCUM_SEARCH_ENABLED,
 *     fail-closed) keeps the first capability opt-in,
 *   - per-cycle bounded work: SEARCH + rank-verify + PLAY the top job only,
 *   - ORDER DRIFT surfaces in the report (and a NOTE is written to the
 *     brain's memory) so the playbook learns about disagreement — the work
 *     still proceeds on the brain's own order (fail-safe, not fail-closed:
 *     the work is pay-ranked by the brain either way).
 */

import { prisma } from "@/lib/db";
import { searchLocumJobs, playLocumJobs, calloraClientConfigured } from "./callora-fleet-client";
import { fleetHalted } from "./fleet-service";

export interface LocumSearchCycleReport {
  ok: boolean;
  reason?: string;
  candidate_id?: string;
  ranked_count?: number;
  top_job?: { job_id: string; rate_usd_hourly: number; title: string | null } | null;
  played?: boolean;
  queued?: number;
  drift?: boolean;
  drift_detail?: { rank1_match: boolean; transpositions: number };
}

export function locumCapabilityEnabled(): boolean {
  return String(process.env.FLEET_CAPABILITY_LOCUM_SEARCH_ENABLED || "").toLowerCase() === "true";
}

/**
 * One capability cycle: search -> verify order -> play the top job.
 * Bounded: exactly ONE top job is queued per invocation.
 */
export async function runLocumJobSearchCycle(input: {
  candidateId?: string;
  candidateName?: string;
  payFloor?: number;
}): Promise<LocumSearchCycleReport> {
  if (fleetHalted()) return { ok: false, reason: "fleet_halted" };
  if (!locumCapabilityEnabled()) return { ok: false, reason: "capability_disabled" };
  if (!calloraClientConfigured()) return { ok: false, reason: "callora_not_configured" };
  const candidateId = String(input.candidateId ?? "").trim();
  const candidateName = String(input.candidateName ?? "").trim();
  if (!candidateId && !candidateName) return { ok: false, reason: "candidate_required" };

  let search;
  try {
    search = await searchLocumJobs({
      ...(candidateId ? { candidateId } : {}),
      ...(candidateName ? { candidateName } : {}),
      payFloor: input.payFloor,
      limit: 10,
    });
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
  const resolvedId = candidateId || candidateName;

  const top = search.ranked[0];
  if (!top) {
    return {
      ok: true,
      candidate_id: resolvedId,
      ranked_count: 0,
      top_job: null,
      drift: search.drift,
      ...(search.drift ? { drift_detail: search.agreement } : {}),
    };
  }

  // Record drift as a brain NOTE when detected (playbook visibility next cycle).
  if (search.drift) {
    await prisma.brainMemory
      .create({
        data: {
          kind: "NOTE",
          summary:
            `locum_rank_drift (candidate=${resolvedId}): rank1_match=${search.agreement.rank1_match} ` +
            `transpositions=${search.agreement.transpositions}`,
        },
      })
      .catch(() => undefined);
  }

  let played: Record<string, unknown> | null = null;
  try {
    played = await playLocumJobs({
      candidateId: resolvedId,
      jobIds: [String(top.job_id)],
    });
  } catch (err) {
    return {
      ok: false,
      reason: `play_failed:${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
      candidate_id: resolvedId,
      drift: search.drift,
    };
  }

  return {
    ok: true,
    candidate_id: resolvedId,
    ranked_count: search.ranked.length,
    top_job: {
      job_id: String(top.job_id),
      rate_usd_hourly: top.rate_usd_hourly,
      title: top.title,
    },
    played: true,
    queued: Number((played as Record<string, unknown>).queued ?? 0),
    drift: search.drift,
    ...(search.drift ? { drift_detail: search.agreement } : {}),
  };
}
