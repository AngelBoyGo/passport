import { describe, it, expect, vi, beforeEach } from "vitest";
import { EngagementStatus, EnrollmentStatus } from "@prisma/client";

const HIRER = "a".repeat(64);
const WORKER = "b".repeat(64);
const TASK_ID = "task_market_001";

const {
  engagementFindUniqueMock,
  engagementCreateMock,
  engagementUpdateMock,
  evidenceFindFirstMock,
  requireEnrolledMock,
  lockCreditsMock,
  unlockCreditsMock,
  releaseEscrowToWorkerMock,
  bridgeEvidenceToReceiptMock,
} = vi.hoisted(() => ({
  engagementFindUniqueMock: vi.fn(),
  engagementCreateMock: vi.fn(),
  engagementUpdateMock: vi.fn(),
  evidenceFindFirstMock: vi.fn(),
  requireEnrolledMock: vi.fn(),
  lockCreditsMock: vi.fn(),
  unlockCreditsMock: vi.fn(),
  releaseEscrowToWorkerMock: vi.fn(),
  bridgeEvidenceToReceiptMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engagement: {
      findUnique: engagementFindUniqueMock,
      create: engagementCreateMock,
      update: engagementUpdateMock,
    },
    agentEvidence: {
      findFirst: evidenceFindFirstMock,
    },
  },
}));

vi.mock("@/lib/enrollment/enrollment-service", () => ({
  requireEnrolled: requireEnrolledMock,
}));

vi.mock("@/lib/angelcoin/ledger-service", () => ({
  lockCredits: lockCreditsMock,
  unlockCredits: unlockCreditsMock,
  releaseEscrowToWorker: releaseEscrowToWorkerMock,
}));

vi.mock("@/lib/evidence-bridge/evidence-receipt-bridge", () => ({
  bridgeEvidenceToReceipt: bridgeEvidenceToReceiptMock,
}));

import {
  acceptEngagement,
  cancelEngagement,
  createEngagement,
  markEngagementDelivered,
} from "@/lib/engagement/engagement-service";
import {
  DuplicateEngagementError,
  EngagementStateError,
  EvidenceRequiredError,
} from "@/lib/engagement/errors";

function heldEngagement() {
  return {
    id: "eng_1",
    taskId: TASK_ID,
    hirerCommitment: HIRER,
    workerCommitment: WORKER,
    amount: 500,
    status: EngagementStatus.HELD,
    deliverableDigest: null,
    evidenceEventHash: null,
    receiptId: null,
    lockJournalEntryId: "lock_1",
    paidAt: null,
    createdAt: new Date("2026-07-04T10:00:00.000Z"),
    updatedAt: new Date("2026-07-04T10:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireEnrolledMock.mockResolvedValue({
    subjectCommitment: WORKER,
    status: EnrollmentStatus.ISSUED,
  });
  lockCreditsMock.mockResolvedValue({
    entry: { id: "lock_1" },
    balances: { availableBalance: 0, lockedBalance: 500 },
  });
});

describe("createEngagement", () => {
  it("locks hirer funds and creates HELD engagement", async () => {
    engagementFindUniqueMock.mockResolvedValue(null);
    engagementCreateMock.mockResolvedValue(heldEngagement());

    const result = await createEngagement({
      taskId: TASK_ID,
      hirerCommitment: HIRER,
      workerCommitment: WORKER,
      amount: 500,
    });

    expect(requireEnrolledMock).toHaveBeenCalledTimes(2);
    expect(lockCreditsMock).toHaveBeenCalledWith(
      HIRER,
      500,
      JSON.stringify({ task_id: TASK_ID, phase: "hire" })
    );
    expect(result.status).toBe("HELD");
    expect(result.taskId).toBe(TASK_ID);
  });

  it("rejects duplicate task_id", async () => {
    engagementFindUniqueMock.mockResolvedValue(heldEngagement());

    await expect(
      createEngagement({
        taskId: TASK_ID,
        hirerCommitment: HIRER,
        workerCommitment: WORKER,
        amount: 500,
      })
    ).rejects.toThrow(DuplicateEngagementError);
  });
});

describe("markEngagementDelivered", () => {
  it("moves HELD engagement to DELIVERED when worker evidence anchors", async () => {
    engagementFindUniqueMock.mockResolvedValue(heldEngagement());
    engagementUpdateMock.mockResolvedValue({
      ...heldEngagement(),
      status: EngagementStatus.DELIVERED,
      deliverableDigest: "d".repeat(64),
      evidenceEventHash: "e".repeat(64),
    });

    const result = await markEngagementDelivered({
      taskId: TASK_ID,
      workerCommitment: WORKER,
      eventCommitmentHash: "e".repeat(64),
      deliverableDigest: "d".repeat(64),
    });

    expect(result?.status).toBe("DELIVERED");
    expect(result?.evidenceEventHash).toBe("e".repeat(64));
  });
});

describe("acceptEngagement", () => {
  it("blocks payout when evidence is not anchored", async () => {
    engagementFindUniqueMock.mockResolvedValue(heldEngagement());

    await expect(acceptEngagement(TASK_ID)).rejects.toThrow(
      EvidenceRequiredError
    );
    expect(releaseEscrowToWorkerMock).not.toHaveBeenCalled();
  });

  it("releases escrow only after DELIVERED + verified evidence", async () => {
    const delivered = {
      ...heldEngagement(),
      status: EngagementStatus.DELIVERED,
      deliverableDigest: "d".repeat(64),
      evidenceEventHash: "e".repeat(64),
    };
    engagementFindUniqueMock.mockResolvedValue(delivered);
    evidenceFindFirstMock.mockResolvedValue({
      id: "ev_1",
      sourceType: "task_deliverable",
      agentIdentityCommitment: WORKER,
      eventCommitmentHash: "e".repeat(64),
      normalizedEventType: "AGENT_ARTIFACT_CREATED",
      rawErrorClassification: "UNKNOWN",
      validationSignalPresent: true,
      observedAt: new Date(),
    });
    releaseEscrowToWorkerMock.mockResolvedValue({
      paymentEntry: { id: "pay_1" },
      balances: { availableBalance: 0, lockedBalance: 0 },
    });
    bridgeEvidenceToReceiptMock.mockResolvedValue({ receiptId: "rcpt_1" });
    engagementUpdateMock.mockResolvedValue({
      ...delivered,
      status: EngagementStatus.PAID,
      receiptId: "rcpt_1",
      paidAt: new Date("2026-07-04T11:00:00.000Z"),
    });

    const result = await acceptEngagement(TASK_ID);

    expect(releaseEscrowToWorkerMock).toHaveBeenCalledWith(
      HIRER,
      WORKER,
      500,
      JSON.stringify({ task_id: TASK_ID, phase: "accept_payout" })
    );
    expect(result.engagement.status).toBe("PAID");
    expect(result.receipt_id).toBe("rcpt_1");
  });
});

describe("cancelEngagement", () => {
  it("unlocks held funds and cancels engagement", async () => {
    engagementFindUniqueMock.mockResolvedValue(heldEngagement());
    engagementUpdateMock.mockResolvedValue({
      ...heldEngagement(),
      status: EngagementStatus.CANCELLED,
    });

    const result = await cancelEngagement(TASK_ID);

    expect(unlockCreditsMock).toHaveBeenCalledWith(
      HIRER,
      500,
      JSON.stringify({ task_id: TASK_ID, phase: "cancel" })
    );
    expect(result.status).toBe("CANCELLED");
  });

  it("rejects cancel after delivery", async () => {
    engagementFindUniqueMock.mockResolvedValue({
      ...heldEngagement(),
      status: EngagementStatus.DELIVERED,
    });

    await expect(cancelEngagement(TASK_ID)).rejects.toThrow(
      EngagementStateError
    );
  });
});
