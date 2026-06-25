-- CreateTable
CREATE TABLE "AgentEvidence" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "normalizedEventType" TEXT NOT NULL,
    "rawErrorClassification" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "agentIdentityCommitment" TEXT NOT NULL,
    "repositoryCommitment" TEXT,
    "branchCommitment" TEXT,
    "commitSha" TEXT,
    "sessionLogUrlCommitment" TEXT,
    "sourceUrl" TEXT,
    "executionStartedAt" TIMESTAMP(3),
    "executionFinishedAt" TIMESTAMP(3),
    "tokenUsageInput" INTEGER,
    "tokenUsageOutput" INTEGER,
    "toolCallCount" INTEGER,
    "validationSignalPresent" BOOLEAN NOT NULL DEFAULT false,
    "eventCommitmentHash" TEXT NOT NULL,
    "sourceDigest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvidence_eventCommitmentHash_key" ON "AgentEvidence"("eventCommitmentHash");

-- CreateIndex
CREATE INDEX "AgentEvidence_agentIdentityCommitment_idx" ON "AgentEvidence"("agentIdentityCommitment");

-- CreateIndex
CREATE INDEX "AgentEvidence_normalizedEventType_idx" ON "AgentEvidence"("normalizedEventType");

-- CreateIndex
CREATE INDEX "AgentEvidence_commitSha_idx" ON "AgentEvidence"("commitSha");

-- CreateIndex
CREATE INDEX "AgentEvidence_agentIdentityCommitment_observedAt_idx" ON "AgentEvidence"("agentIdentityCommitment", "observedAt");
