-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KycStatus') THEN
    CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApiKeyRole') THEN
    CREATE TYPE "ApiKeyRole" AS ENUM ('ISSUER', 'HOLDER');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "AngelCoinAccount" ADD COLUMN IF NOT EXISTS "ownerOperatorId" TEXT;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "role" "ApiKeyRole" NOT NULL DEFAULT 'ISSUER';

-- AlterTable
ALTER TABLE "BrainLease" ALTER COLUMN "id" SET DEFAULT 'command-brain';

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN IF NOT EXISTS "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentInstance" (
    "id" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "agentRecordId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "llmTier" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "desiredCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalEarnedCents" INTEGER NOT NULL DEFAULT 0,
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0,
    "capsuleDigest" TEXT,
    "rehydratedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProvisionChallenge" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "publicKeyHex" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvisionChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExternalSettlement" (
    "id" TEXT NOT NULL,
    "rail" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "creditCredits" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KeyLogEntry" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "publicKeyHex" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "status" TEXT NOT NULL DEFAULT 'active',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "seededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OperatorLedgerEntry" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "deltaMicros" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BridgeWallet" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "subjectCommitment" TEXT,
    "bridgeExternalId" TEXT,
    "chainAddress" TEXT,
    "upstream" TEXT NOT NULL DEFAULT 'bridge',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BridgeWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReferralCode" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bonusCredits" INTEGER NOT NULL DEFAULT 50,
    "totalUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EvidenceBridgeRetry" (
    "id" TEXT NOT NULL,
    "eventCommitmentHash" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "lastRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceBridgeRetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "senderCommitment" TEXT NOT NULL,
    "recipientCommitment" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "replyToId" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentWallet" (
    "id" TEXT NOT NULL,
    "subjectCommitment" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "staked" INTEGER NOT NULL DEFAULT 0,
    "earnedTotal" INTEGER NOT NULL DEFAULT 0,
    "spentTotal" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentSubscription" (
    "id" TEXT NOT NULL,
    "subscriberCommitment" TEXT NOT NULL,
    "targetCommitment" TEXT NOT NULL,
    "notifyOnEvidence" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnHire" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnBroadcast" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentDelegationToken" (
    "id" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "platformName" TEXT NOT NULL,
    "scopes" TEXT[],
    "nonce" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDelegationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WalletClaimToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentInstance_commitment_key" ON "AgentInstance"("commitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentInstance_operatorId_status_idx" ON "AgentInstance"("operatorId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentInstance_capability_status_idx" ON "AgentInstance"("capability", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProvisionChallenge_nonce_key" ON "ProvisionChallenge"("nonce");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvisionChallenge_publicKeyHex_idx" ON "ProvisionChallenge"("publicKeyHex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvisionChallenge_expiresAt_idx" ON "ProvisionChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExternalSettlement_operatorId_idx" ON "ExternalSettlement"("operatorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExternalSettlement_rail_reference_idx" ON "ExternalSettlement"("rail", "reference");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalSettlement_operatorId_rail_reference_key" ON "ExternalSettlement"("operatorId", "rail", "reference");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KeyLogEntry_kid_key" ON "KeyLogEntry"("kid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeyLogEntry_status_idx" ON "KeyLogEntry"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeyLogEntry_publicKeyHex_idx" ON "KeyLogEntry"("publicKeyHex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OperatorLedgerEntry_operatorId_createdAt_idx" ON "OperatorLedgerEntry"("operatorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BridgeWallet_operatorId_key" ON "BridgeWallet"("operatorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BridgeWallet_operatorId_idx" ON "BridgeWallet"("operatorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BridgeWallet_subjectCommitment_idx" ON "BridgeWallet"("subjectCommitment");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_operatorId_key" ON "ReferralCode"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReferralCode_code_idx" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_operatorId_idx" ON "AdminAuditLog"("operatorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceBridgeRetry_eventCommitmentHash_key" ON "EvidenceBridgeRetry"("eventCommitmentHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceBridgeRetry_retryCount_idx" ON "EvidenceBridgeRetry"("retryCount");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceBridgeRetry_createdAt_idx" ON "EvidenceBridgeRetry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMessage_messageId_key" ON "AgentMessage"("messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentMessage_senderCommitment_idx" ON "AgentMessage"("senderCommitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentMessage_recipientCommitment_idx" ON "AgentMessage"("recipientCommitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentMessage_recipientCommitment_createdAt_idx" ON "AgentMessage"("recipientCommitment", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentMessage_createdAt_idx" ON "AgentMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentWallet_subjectCommitment_key" ON "AgentWallet"("subjectCommitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentWallet_subjectCommitment_idx" ON "AgentWallet"("subjectCommitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentSubscription_subscriberCommitment_idx" ON "AgentSubscription"("subscriberCommitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentSubscription_targetCommitment_idx" ON "AgentSubscription"("targetCommitment");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentSubscription_subscriberCommitment_targetCommitment_key" ON "AgentSubscription"("subscriberCommitment", "targetCommitment");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentDelegationToken_nonce_key" ON "AgentDelegationToken"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentDelegationToken_tokenHash_key" ON "AgentDelegationToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentDelegationToken_agentCommitment_idx" ON "AgentDelegationToken"("agentCommitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentDelegationToken_platformName_idx" ON "AgentDelegationToken"("platformName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentDelegationToken_expiresAt_idx" ON "AgentDelegationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WalletClaimToken_token_key" ON "WalletClaimToken"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WalletClaimToken_email_idx" ON "WalletClaimToken"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WalletClaimToken_commitment_idx" ON "WalletClaimToken"("commitment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentEvidence_agentIdentityCommitment_observedAt_normalized_idx" ON "AgentEvidence"("agentIdentityCommitment", "observedAt", "normalizedEventType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentEvidence_observedAt_normalizedEventType_idx" ON "AgentEvidence"("observedAt", "normalizedEventType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AngelCoinAccount_ownerOperatorId_idx" ON "AngelCoinAccount"("ownerOperatorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Receipt_operatorId_issuedAt_idx" ON "Receipt"("operatorId", "issuedAt");
