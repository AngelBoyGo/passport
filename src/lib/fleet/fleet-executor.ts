/**
 * Fleet executor + dispatch tick — moves authorized money intents into REAL
 * escrowed engagements, executed only by provisioned money-tier agents.
 *
 * Money flow (end to end):
 *   brain stages intent (PENDING)
 *     -> money-tier agent signs + authorizeMoneyMovement() flips to AUTHORIZED
 *     -> THIS executor creates the Engagement: createEngagement() locks the
 *        hirer's ANGEL in escrow (journal LOCK->SPEND->TASK_PAYMENT on settle)
 *     -> intent flips to EXECUTED. The brain never touched a balance; the
 *        ledger service did — exactly the owner-approved invariant.
 *
 * Dispatch tick: single-flight via the fleet-dispatch lease (fails closed),
 * bounded batch (default 5 intents/tick). Until the hirer wallet is funded,
 * createEngagement refuses — intents stay AUTHORIZED and re-try next tick;
 * the failure reason is recorded on the row each attempt.
 */

import { prisma } from "@/lib/db";
import { createEngagement } from "@/lib/engagement/engagement-service";
import { acquireLease, releaseLease } from "@/lib/scheduler/lease";

export const FLEET_DISPATCH_LEASE_ID = "fleet-dispatch";

export function dispatchHalt(): boolean {
  return String(process.env.FLEET_HALT || "").toLowerCase() === "true";
}

export interface DispatchReport {
  executed: string[];
  retriable_failures: Array<{ intent_id: string; error: string }>;
  skipped: number;
  halted: boolean;
}

/**
 * Executes AUTHORIZED money intents (signature already verified at the gate).
 * Bounded, idempotent per intent (status guard + unique task id), and honest
 * about failures. `hire_agent` is the only kind executable today.
 */
export async function executeAuthorizedIntents(limit = 5): Promise<DispatchReport> {
  if (dispatchHalt()) {
    return { executed: [], retriable_failures: [], skipped: 0, halted: true };
  }

  const rows = await prisma.moneyIntent.findMany({
    where: { status: "AUTHORIZED", signature: { not: null } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 25),
  });

  const report: DispatchReport = {
    executed: [],
    retriable_failures: [],
    skipped: 0,
    halted: false,
  };

  for (const intent of rows) {
    if (intent.intentKind !== "hire_agent") {
      await prisma.moneyIntent.update({
        where: { id: intent.id },
        data: { rejectionReason: `exec_unsupported_kind:${intent.intentKind}` },
      }).catch(() => undefined);
      report.skipped++;
      continue;
    }
    const worker = intent.workerCommitment?.toLowerCase() ?? null;
    const hirer = intent.requesterCommitment?.toLowerCase() ?? null;
    if (!worker || !hirer || worker === hirer) {
      await prisma.moneyIntent.update({
        where: { id: intent.id },
        data: { status: "REJECTED", rejectionReason: "exec_invalid_parties" },
      }).catch(() => undefined);
      report.retriable_failures.push({ intent_id: intent.id, error: "invalid_parties" });
      continue;
    }
    try {
      await createEngagement({
        taskId: `fleet_${intent.id}`,
        hirerCommitment: hirer,
        workerCommitment: worker,
        amount: intent.amountAngels,
      });
      await prisma.moneyIntent.update({
        where: { id: intent.id },
        data: { status: "EXECUTED", executedAt: new Date(), rejectionReason: null },
      });
      report.executed.push(intent.id);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 200);
      // Keep AUTHORIZED: the intent survives for the next tick (insufficient
      // escrow balance is the canonical transient case — top up, and it lands).
      await prisma.moneyIntent.update({
        where: { id: intent.id },
        data: { rejectionReason: `exec_attempt_failed:${msg}` },
      }).catch(() => undefined);
      report.retriable_failures.push({ intent_id: intent.id, error: msg });
    }
  }
  return report;
}

/** One scheduler tick. Lease-guarded single-flight, fail-closed. */
export async function runFleetDispatchTick(options: { lease?: boolean } = {}): Promise<{
  ran_lease: boolean;
  report: DispatchReport | null;
}> {
  if (options.lease === false) {
    return { ran_lease: false, report: await executeAuthorizedIntents() };
  }
  let ownerId: string | null = null;
  try {
    const lease = await acquireLease(FLEET_DISPATCH_LEASE_ID);
    if (!lease) {
      return { ran_lease: false, report: null };
    }
    ownerId = lease.ownerId;
    const report = await executeAuthorizedIntents();
    return { ran_lease: true, report };
  } finally {
    if (ownerId) {
      await releaseLease(FLEET_DISPATCH_LEASE_ID, ownerId).catch(() => undefined);
    }
  }
}
