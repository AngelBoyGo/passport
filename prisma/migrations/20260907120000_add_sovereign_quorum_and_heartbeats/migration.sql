-- CreateTable
CREATE TABLE "SovereignQuorumProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "proposerState" TEXT NOT NULL,
    "requiredThreshold" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SovereignQuorumProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuorumSignature" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "signerState" TEXT NOT NULL,
    "signerPublicKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuorumSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SovereignStateHeartbeat" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "nodeEndpoint" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatNonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SovereignStateHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SovereignQuorumProposal_proposalId_key" ON "SovereignQuorumProposal"("proposalId");

-- CreateIndex
CREATE INDEX "SovereignQuorumProposal_actionType_idx" ON "SovereignQuorumProposal"("actionType");

-- CreateIndex
CREATE INDEX "SovereignQuorumProposal_status_idx" ON "SovereignQuorumProposal"("status");

-- CreateIndex
CREATE INDEX "SovereignQuorumProposal_expiresAt_idx" ON "SovereignQuorumProposal"("expiresAt");

-- CreateIndex
CREATE INDEX "QuorumSignature_signerState_idx" ON "QuorumSignature"("signerState");

-- CreateIndex
CREATE UNIQUE INDEX "QuorumSignature_proposalId_signerState_key" ON "QuorumSignature"("proposalId", "signerState");

-- CreateIndex
CREATE UNIQUE INDEX "SovereignStateHeartbeat_countryCode_key" ON "SovereignStateHeartbeat"("countryCode");

-- AddForeignKey
ALTER TABLE "QuorumSignature" ADD CONSTRAINT "QuorumSignature_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SovereignQuorumProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
