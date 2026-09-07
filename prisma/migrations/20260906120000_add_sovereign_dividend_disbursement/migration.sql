-- CreateTable
CREATE TABLE "SovereignDisbursement" (
    "id" TEXT NOT NULL,
    "disbursementId" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "totalFeeAngel" INTEGER NOT NULL,
    "stateNationalAngel" INTEGER NOT NULL,
    "stateCommunityAngel" INTEGER NOT NULL,
    "stateWorkersAngel" INTEGER NOT NULL,
    "treasuryStabilizationAngel" INTEGER NOT NULL,
    "validatorPoolAngel" INTEGER NOT NULL,
    "agentRebateAngel" INTEGER NOT NULL,
    "districtName" TEXT NOT NULL DEFAULT 'Central Concession',
    "countryCode" TEXT NOT NULL,
    "disbursedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SovereignDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SovereignDisbursement_disbursementId_key" ON "SovereignDisbursement"("disbursementId");

-- CreateIndex
CREATE INDEX "SovereignDisbursement_escrowId_idx" ON "SovereignDisbursement"("escrowId");

-- CreateIndex
CREATE INDEX "SovereignDisbursement_batchNumber_idx" ON "SovereignDisbursement"("batchNumber");

-- CreateIndex
CREATE INDEX "SovereignDisbursement_countryCode_idx" ON "SovereignDisbursement"("countryCode");

-- CreateIndex
CREATE INDEX "SovereignDisbursement_disbursedAt_idx" ON "SovereignDisbursement"("disbursedAt");
