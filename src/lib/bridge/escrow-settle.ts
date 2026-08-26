import { prisma } from "@/lib/db";

/**
 * Optional on-chain escrow settlement.
 *
 * When a hirer accepts and requests on-chain settlement, we enqueue an ANGL
 * transfer to the worker's custodial wallet. This is separate from, and
 * non-blocking to, the internal custodial payout (which always runs). Exactly-once
 * is enforced by the unique (rail, reference) on ExternalSettlement plus an
 * explicit pre-check.
 */

export async function enqueueWorkerTransfer(opts: {
  taskId: string;
  workerCommitment: string;
  amount: number;
}): Promise<{
  enqueued: boolean;
  already?: boolean;
  reason?: string;
  workerChainAddress: string | null;
  workerId: string | null;
}> {
  const reference = `escrow_${opts.taskId}`;

  // Pre-check: already settled (fast path + distinct reason).
  const prior = await prisma.externalSettlement.findFirst({
    where: { rail: "bridge_transfer", reference },
    select: { id: true },
  });
  if (prior) {
    return { enqueued: false, already: true, reason: "Transfer already enqueued", workerChainAddress: null, workerId: null };
  }

  // Resolve the worker's custodial wallet (may not exist yet → settle later).
  const wallet = await prisma.bridgeWallet.findFirst({
    where: { subjectCommitment: opts.workerCommitment },
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.externalSettlement.create({
        data: {
          rail: "bridge_transfer",
          reference,
          operatorId: wallet?.operatorId ?? "op_pending",
          creditCredits: opts.amount,
          label: `escrow on-chain payout (${opts.taskId})`,
        },
      });
      await tx.capabilityLedgerEntry.create({
        data: {
          operatorId: wallet?.operatorId ?? "op_pending",
          eventType: "settlement:bridge_transfer",
          metadata: JSON.stringify({ reference, amount: opts.amount, task_id: opts.taskId }),
        },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { enqueued: false, already: true, reason: "Transfer already enqueued", workerChainAddress: null, workerId: null };
    }
    return { enqueued: false, reason: err instanceof Error ? err.message : "Enqueue failed", workerChainAddress: null, workerId: null };
  }

  return {
    enqueued: true,
    workerChainAddress: wallet?.chainAddress ?? null,
    workerId: wallet?.operatorId ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}