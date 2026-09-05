-- CreateTable
CREATE TABLE "SwarmMemory" (
    "id" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'global',
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "parentHash" TEXT,
    "merkleRoot" TEXT,
    "feeDeducted" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwarmMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResurrectionCapsule" (
    "id" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "encryptedPayload" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResurrectionCapsule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwarmThreatReport" (
    "id" TEXT NOT NULL,
    "reporterCommitment" TEXT NOT NULL,
    "targetDomain" TEXT NOT NULL,
    "threatType" TEXT NOT NULL,
    "details" JSONB,
    "evidenceDigest" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "bountyAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwarmThreatReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SwarmMemory_agentCommitment_idx" ON "SwarmMemory"("agentCommitment");

-- CreateIndex
CREATE INDEX "SwarmMemory_channel_idx" ON "SwarmMemory"("channel");

-- CreateIndex
CREATE INDEX "SwarmMemory_topic_idx" ON "SwarmMemory"("topic");

-- CreateIndex
CREATE INDEX "SwarmMemory_createdAt_idx" ON "SwarmMemory"("createdAt");

-- CreateIndex
CREATE INDEX "SwarmMemory_payloadDigest_idx" ON "SwarmMemory"("payloadDigest");

-- CreateIndex
CREATE UNIQUE INDEX "ResurrectionCapsule_agentCommitment_key" ON "ResurrectionCapsule"("agentCommitment");

-- CreateIndex
CREATE INDEX "ResurrectionCapsule_agentCommitment_idx" ON "ResurrectionCapsule"("agentCommitment");

-- CreateIndex
CREATE INDEX "SwarmThreatReport_targetDomain_idx" ON "SwarmThreatReport"("targetDomain");

-- CreateIndex
CREATE INDEX "SwarmThreatReport_threatType_idx" ON "SwarmThreatReport"("threatType");

-- CreateIndex
CREATE INDEX "SwarmThreatReport_createdAt_idx" ON "SwarmThreatReport"("createdAt");

-- CreateTable
CREATE TABLE "SwarmBounty" (
    "id" TEXT NOT NULL,
    "creatorCommitment" TEXT NOT NULL,
    "workerCommitment" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bountyType" TEXT NOT NULL DEFAULT 'GENERAL',
    "rewardAngel" INTEGER NOT NULL,
    "feeAngel" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "deliverableDigest" TEXT,
    "deliverableUrl" TEXT,
    "workerSignature" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwarmBounty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SwarmBounty_creatorCommitment_idx" ON "SwarmBounty"("creatorCommitment");

-- CreateIndex
CREATE INDEX "SwarmBounty_workerCommitment_idx" ON "SwarmBounty"("workerCommitment");

-- CreateIndex
CREATE INDEX "SwarmBounty_status_idx" ON "SwarmBounty"("status");

-- CreateIndex
CREATE INDEX "SwarmBounty_bountyType_idx" ON "SwarmBounty"("bountyType");

-- CreateIndex
CREATE INDEX "SwarmBounty_createdAt_idx" ON "SwarmBounty"("createdAt");

