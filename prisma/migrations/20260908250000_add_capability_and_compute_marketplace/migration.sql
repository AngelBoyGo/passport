-- Phase 32: agent capability registry + metered compute marketplace.

-- AgentCapability
CREATE TABLE "AgentCapability" (
    "id" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT,
    "endpointUrl" TEXT,
    "priceAngel" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'task',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCapability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentCapability_agentCommitment_capability_key" ON "AgentCapability"("agentCommitment", "capability");
CREATE INDEX "AgentCapability_capability_idx" ON "AgentCapability"("capability");
CREATE INDEX "AgentCapability_active_idx" ON "AgentCapability"("active");

-- ComputeOffer
CREATE TABLE "ComputeOffer" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "providerCommitment" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT '1k_tokens',
    "priceAngelPerUnit" INTEGER NOT NULL,
    "capacityUnits" INTEGER NOT NULL,
    "remainingUnits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputeOffer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComputeOffer_offerId_key" ON "ComputeOffer"("offerId");
CREATE INDEX "ComputeOffer_capability_status_idx" ON "ComputeOffer"("capability", "status");
CREATE INDEX "ComputeOffer_providerCommitment_idx" ON "ComputeOffer"("providerCommitment");

-- ComputePurchase
CREATE TABLE "ComputePurchase" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "buyerCommitment" TEXT NOT NULL,
    "providerCommitment" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "totalAngel" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SETTLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputePurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComputePurchase_purchaseId_key" ON "ComputePurchase"("purchaseId");
CREATE INDEX "ComputePurchase_offerId_idx" ON "ComputePurchase"("offerId");
CREATE INDEX "ComputePurchase_buyerCommitment_idx" ON "ComputePurchase"("buyerCommitment");
