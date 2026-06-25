-- CreateEnum
CREATE TYPE "EvidenceLinkageType" AS ENUM ('OBSERVATION', 'CORRECTION', 'FAILURE', 'VALIDATION');

-- CreateEnum
CREATE TYPE "EvidenceEnforcementState" AS ENUM ('OBSERVATIONAL_ONLY', 'AUDIT_RELEVANT', 'ENFORCEMENT_ELIGIBLE');

-- CreateTable
CREATE TABLE "EvidenceReceiptLink" (
    "id" TEXT NOT NULL,
    "agentEvidenceId" TEXT NOT NULL,
    "eventCommitmentHash" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptCommitmentHash" TEXT NOT NULL,
    "linkageType" "EvidenceLinkageType" NOT NULL,
    "enforcementState" "EvidenceEnforcementState" NOT NULL,
    "attributionMode" TEXT NOT NULL DEFAULT 'SYSTEM_ATTESTED_PUBLIC_EVIDENCE',
    "liabilityEventId" TEXT,
    "predicateVersion" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceReceiptLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceReceiptLink_eventCommitmentHash_key" ON "EvidenceReceiptLink"("eventCommitmentHash");

-- CreateIndex
CREATE INDEX "EvidenceReceiptLink_receiptId_idx" ON "EvidenceReceiptLink"("receiptId");

-- AddForeignKey
ALTER TABLE "EvidenceReceiptLink" ADD CONSTRAINT "EvidenceReceiptLink_agentEvidenceId_fkey" FOREIGN KEY ("agentEvidenceId") REFERENCES "AgentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
