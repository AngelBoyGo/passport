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
import { createEngagement, getEngagement } from "@/lib/engagement/engagement-service";
import { EngagementNotFoundError } from "@/lib/engagement/errors";
import { acquireLease, releaseLease } from "@/lib/scheduler/lease";

export const FLEET_DISPATCH_LEASE_ID = "fleet-dispatch";

/** Max exec attempts before an intent is terminally rejected (stops head-of-line starvation). */
const MAX_EXEC_ATTEMPTS = 10;

export function dispatchHalt(): boolean {
  return String(process.env.FLEET_HALT || "").toLowerCase() === "true";
}

export interface DispatchReport {
  executed: string[];
  retriable_failures: Array<{ intent_id: string; error: string }>;
  exhausted: string[];
  halted: boolean;
}

/**
 * Executes AUTHORIZED money intents (signature already verified at the gate).
 *
 * Bounded + starvation-safe:
 *   - only `hire_agent` is scanned (unsupported kinds never occupy the batch),
 *   - retries ROTATE by lastAttemptAt (a failing intent cannot block newer ones),
 *   - attempts are capped: past MAX_EXEC_ATTEMPTS the intent is terminally
 *     REJECTED (exec_attempts_exhausted) instead of looping forever,
 *   - idempotent: if the engagement row already exists for this intent (a
 *     crash between createEngagement and the status write), it is treated as
 *     EXECUTED rather than re-created (taskId is unique).
 */
export async function executeAuthorizedIntents(limit = 5): Promise<DispatchReport> {
  if (dispatchHalt()) {
    return { executed: [], retriable_failures: [], exhausted: [], halted: true };
  }

  const rows = await prisma.moneyIntent.findMany({
    where: { status: "AUTHORIZED", signature: { not: null }, intentKind: "hire_agent" },
    orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: Math.min(Math.max(limit, 1), 25),
  });

  const report: DispatchReport = {
    executed: [],
    retriable_failures: [],
    exhausted: [],
    halted: false,
  };

  for (const intent of rows) {
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

    const taskId = `fleet_${intent.id}`;

    // Crash-recovery idempotency: an engagement with this taskId means a prior
    // attempt got past createEngagement but died before the status write.
    try {
      await getEngagement(taskId);
      await markExecuted(intent.id, report);
      continue;
    } catch (err) {
      if (!(err instanceof EngagementNotFoundError)) {
        // Unknown lookup failure: count the attempt, do not execute blind.
        await recordAttempt(intent.id, `exec_lookup_failed:${String(err).slice(0, 120)}`, report);
        continue;
      }
    }

    try {
      await createEngagement({
        taskId,
        hirerCommitment: hirer,
        workerCommitment: worker,
        amount: intent.amountAngels,
      });
      await markExecuted(intent.id, report);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 200);
      await recordAttempt(intent.id, msg, report);
    }
  }
  return report;

  async function markExecuted(intentId: string, rep: DispatchReport): Promise<void> {
    await prisma.moneyIntent.update({
      where: { id: intentId },
      data: { status: "EXECUTED", executedAt: new Date(), rejectionReason: null },
    }).catch(() => undefined);
    rep.executed.push(intentId);
  }

  async function recordAttempt(intentId: string, msg: string, rep: DispatchReport): Promise<void> {
    const next = await prisma.moneyIntent
      .update({
        where: { id: intentId },
        data: {
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          rejectionReason: `exec_attempt_failed:${msg}`,
        },
        select: { attemptCount: true },
      })
      .catch(() => null);
    const attempts = next?.attemptCount ?? Number.MAX_SAFE_INTEGER;
    if (attempts >= MAX_EXEC_ATTEMPTS) {
      await prisma.moneyIntent.update({
        where: { id: intentId },
        data: {
          status: "REJECTED",
          rejectionReason: `exec_attempts_exhausted:${msg}`,
        },
      }).catch(() => undefined);
      rep.exhausted.push(intentId);
    } else {
      // Keep AUTHORIZED for a later, ROTATED retry (fund the wallet and it lands).
      rep.retriable_failures.push({ intent_id: intentId, error: msg });
    }
  }
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
