-- Phase 35: delivery verification, dispute arbitration, and external revenue bridge.

-- ComputePurchase: verification fields + default status HELD (pay-on-delivery).
ALTER TABLE "ComputePurchase" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ComputePurchase" ADD COLUMN "deliverableDigest" TEXT;
ALTER TABLE "ComputePurchase" ADD COLUMN "verifierCommitment" TEXT;
ALTER TABLE "ComputePurchase" ADD COLUMN "verificationVerdict" TEXT;
ALTER TABLE "ComputePurchase" ALTER COLUMN "status" SET DEFAULT 'HELD';
CREATE INDEX "ComputePurchase_providerCommitment_idx" ON "ComputePurchase"("providerCommitment");

-- ComputeDispute
CREATE TABLE "ComputeDispute" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ComputeDispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComputeDispute_disputeId_key" ON "ComputeDispute"("disputeId");
CREATE INDEX "ComputeDispute_purchaseId_idx" ON "ComputeDispute"("purchaseId");
CREATE INDEX "ComputeDispute_status_idx" ON "ComputeDispute"("status");

-- ComputeDisputeVote
CREATE TABLE "ComputeDisputeVote" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "jurorCommitment" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputeDisputeVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComputeDisputeVote_disputeId_jurorCommitment_key" ON "ComputeDisputeVote"("disputeId", "jurorCommitment");
CREATE INDEX "ComputeDisputeVote_disputeId_idx" ON "ComputeDisputeVote"("disputeId");

-- AgentRevenue
CREATE TABLE "AgentRevenue" (
    "id" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "grossUsdCents" INTEGER NOT NULL,
    "angelCredited" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREDITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRevenue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentRevenue_externalRef_key" ON "AgentRevenue"("externalRef");
CREATE INDEX "AgentRevenue_agentCommitment_idx" ON "AgentRevenue"("agentCommitment");
