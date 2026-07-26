import { EngagementStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  lockCredits,
  releaseEscrowToWorker,
  unlockCredits,
} from "@/lib/angelcoin/ledger-service";
import { bridgeEvidenceToReceipt } from "@/lib/evidence-bridge/evidence-receipt-bridge";
import { requireEnrolled } from "@/lib/enrollment/enrollment-service";
import {
  DuplicateEngagementError,
  EngagementNotFoundError,
  EngagementStateError,
  EvidenceMismatchError,
  EvidenceRequiredError,
} from "@/lib/engagement/errors";

export type EngagementRecord = {
  taskId: string;
  hirerCommitment: string;
  workerCommitment: string;
  amount: number;
  status: EngagementStatus;
  deliverableDigest: string | null;
  evidenceEventHash: string | null;
  receiptId: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toEngagementRecord(row: {
  taskId: string;
  hirerCommitment: string;
  workerCommitment: string;
  amount: number;
  status: EngagementStatus;
  deliverableDigest: string | null;
  evidenceEventHash: string | null;
  receiptId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): EngagementRecord {
  return {
    taskId: row.taskId,
    hirerCommitment: row.hirerCommitment,
    workerCommitment: row.workerCommitment,
    amount: row.amount,
    status: row.status,
    deliverableDigest: row.deliverableDigest,
    evidenceEventHash: row.evidenceEventHash,
    receiptId: row.receiptId,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Creates a marketplace engagement and locks hirer funds in escrow.
 */
export async function createEngagement(input: {
  taskId: string;
  hirerCommitment: string;
  workerCommitment: string;
  amount: number;
}): Promise<EngagementRecord> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error("task_id is required");
  }
  if (input.hirerCommitment === input.workerCommitment) {
    throw new Error("hirer and worker must be different commitments");
  }

  const existing = await prisma.engagement.findUnique({ where: { taskId } });
  if (existing) {
    throw new DuplicateEngagementError(taskId);
  }

  await requireEnrolled(input.hirerCommitment);
  await requireEnrolled(input.workerCommitment);

  const lock = await lockCredits(
    input.hirerCommitment,
    input.amount,
    JSON.stringify({ task_id: taskId, phase: "hire" })
  );

  const row = await prisma.engagement.create({
    data: {
      taskId,
      hirerCommitment: input.hirerCommitment.toLowerCase(),
      workerCommitment: input.workerCommitment.toLowerCase(),
      amount: input.amount,
      status: EngagementStatus.HELD,
      lockJournalEntryId: lock.entry.id,
    },
  });

  return toEngagementRecord(row);
}

/**
 * Loads an engagement by external task id.
 */
export async function getEngagement(taskId: string): Promise<EngagementRecord> {
  const row = await prisma.engagement.findUnique({
    where: { taskId: taskId.trim() },
  });
  if (!row) {
    throw new EngagementNotFoundError(taskId);
  }
  return toEngagementRecord(row);
}

/**
 * Marks an engagement delivered after worker evidence is anchored on Passport.
 */
export async function markEngagementDelivered(input: {
  taskId: string;
  workerCommitment: string;
  eventCommitmentHash: string;
  deliverableDigest: string;
}): Promise<EngagementRecord | null> {
  const taskId = input.taskId.trim();
  const row = await prisma.engagement.findUnique({ where: { taskId } });
  if (!row) {
    return null;
  }
  if (row.status !== EngagementStatus.HELD) {
    return toEngagementRecord(row);
  }
  if (row.workerCommitment !== input.workerCommitment.toLowerCase()) {
    throw new EvidenceMismatchError();
  }

  const updated = await prisma.engagement.update({
    where: { taskId },
    data: {
      status: EngagementStatus.DELIVERED,
      evidenceEventHash: input.eventCommitmentHash,
      deliverableDigest: input.deliverableDigest.toLowerCase(),
    },
  });

  return toEngagementRecord(updated);
}

/**
 * Verifies anchored deliverable evidence exists for an engagement.
 */
export async function findDeliverableEvidence(taskId: string) {
  const engagement = await prisma.engagement.findUnique({
    where: { taskId: taskId.trim() },
  });
  if (!engagement?.evidenceEventHash) {
    return null;
  }

  return prisma.agentEvidence.findFirst({
    where: {
      eventCommitmentHash: engagement.evidenceEventHash,
      agentIdentityCommitment: engagement.workerCommitment,
      sourceType: "task_deliverable",
      externalTaskId: taskId,
      validationSignalPresent: true,
    },
  });
}

/**
 * Accepts a delivered engagement: evidence is a hard gate before escrow payout.
 */
export async function acceptEngagement(taskId: string): Promise<{
  engagement: EngagementRecord;
  payout: Awaited<ReturnType<typeof releaseEscrowToWorker>> | null;
  receipt_id: string | null;
  already_paid?: boolean;
}> {
  const normalizedTaskId = taskId.trim();
  const row = await prisma.engagement.findUnique({
    where: { taskId: normalizedTaskId },
  });
  if (!row) {
    throw new EngagementNotFoundError(normalizedTaskId);
  }
  if (row.status === EngagementStatus.PAID) {
    return {
      engagement: toEngagementRecord(row),
      payout: null,
      receipt_id: row.receiptId,
      already_paid: true,
    };
  }
  if (row.status !== EngagementStatus.DELIVERED) {
    if (row.status === EngagementStatus.HELD) {
      throw new EvidenceRequiredError(normalizedTaskId);
    }
    throw new EngagementStateError(
      `Engagement ${normalizedTaskId} cannot be accepted from status ${row.status}`,
      row.status
    );
  }

  const evidence = await findDeliverableEvidence(normalizedTaskId);
  if (!evidence) {
    throw new EvidenceRequiredError(normalizedTaskId);
  }

  const payout = await releaseEscrowToWorker(
    row.hirerCommitment,
    row.workerCommitment,
    row.amount,
    JSON.stringify({ task_id: normalizedTaskId, phase: "accept_payout" })
  );

  let receiptId: string | null = row.receiptId;
  if (!receiptId) {
    const link = await bridgeEvidenceToReceipt({
      id: evidence.id,
      sourceType: evidence.sourceType,
      agentIdentityCommitment: evidence.agentIdentityCommitment,
      eventCommitmentHash: evidence.eventCommitmentHash,
      normalizedEventType: evidence.normalizedEventType,
      rawErrorClassification: evidence.rawErrorClassification,
      validationSignalPresent: evidence.validationSignalPresent,
      observedAt: evidence.observedAt,
    });
    receiptId = link?.receiptId ?? null;
  }

  const updated = await prisma.engagement.update({
    where: { taskId: normalizedTaskId },
    data: {
      status: EngagementStatus.PAID,
      receiptId,
      paidAt: new Date(),
    },
  });

  return {
    engagement: toEngagementRecord(updated),
    payout,
    receipt_id: receiptId,
  };
}

/**
 * Cancels a held engagement and returns locked funds to the hirer.
 */
export async function cancelEngagement(taskId: string): Promise<EngagementRecord> {
  const normalizedTaskId = taskId.trim();
  const row = await prisma.engagement.findUnique({
    where: { taskId: normalizedTaskId },
  });
  if (!row) {
    throw new EngagementNotFoundError(normalizedTaskId);
  }
  if (row.status === EngagementStatus.PAID) {
    throw new EngagementStateError(
      `Engagement ${normalizedTaskId} is already paid`,
      row.status
    );
  }
  if (row.status === EngagementStatus.CANCELLED) {
    return toEngagementRecord(row);
  }
  if (row.status === EngagementStatus.DELIVERED) {
    throw new EngagementStateError(
      `Engagement ${normalizedTaskId} cannot be cancelled after delivery`,
      row.status
    );
  }

  await unlockCredits(
    row.hirerCommitment,
    row.amount,
    JSON.stringify({ task_id: normalizedTaskId, phase: "cancel" })
  );

  const updated = await prisma.engagement.update({
    where: { taskId: normalizedTaskId },
    data: { status: EngagementStatus.CANCELLED },
  });

  return toEngagementRecord(updated);
}
