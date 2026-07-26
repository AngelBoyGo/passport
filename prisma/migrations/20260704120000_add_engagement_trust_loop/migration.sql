-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('HELD', 'DELIVERED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "AgentEvidence" ADD COLUMN "externalTaskId" TEXT;

-- CreateIndex
CREATE INDEX "AgentEvidence_externalTaskId_idx" ON "AgentEvidence"("externalTaskId");

-- CreateIndex
CREATE INDEX "AgentEvidence_agentIdentityCommitment_externalTaskId_idx" ON "AgentEvidence"("agentIdentityCommitment", "externalTaskId");

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "hirerCommitment" TEXT NOT NULL,
    "workerCommitment" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'HELD',
    "deliverableDigest" TEXT,
    "evidenceEventHash" TEXT,
    "receiptId" TEXT,
    "lockJournalEntryId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_taskId_key" ON "Engagement"("taskId");

-- CreateIndex
CREATE INDEX "Engagement_hirerCommitment_idx" ON "Engagement"("hirerCommitment");

-- CreateIndex
CREATE INDEX "Engagement_workerCommitment_idx" ON "Engagement"("workerCommitment");

-- CreateIndex
CREATE INDEX "Engagement_status_idx" ON "Engagement"("status");
