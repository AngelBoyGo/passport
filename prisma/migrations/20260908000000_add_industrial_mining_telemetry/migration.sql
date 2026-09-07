-- CreateTable
CREATE TABLE "IndustrialMiningConcession" (
    "id" TEXT NOT NULL,
    "concessionCode" TEXT NOT NULL,
    "concessionName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "operatorCompany" TEXT NOT NULL,
    "statutoryRoyaltyPercent" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "stateParticipationPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "smelterHsmPublicKey" TEXT NOT NULL,
    "activeStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalPouredGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRoyaltiesAngel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndustrialMiningConcession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmeltingRunTelemetry" (
    "id" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "concessionId" TEXT NOT NULL,
    "concessionCode" TEXT NOT NULL,
    "grossPouredGrams" DOUBLE PRECISION NOT NULL,
    "densityGramsPerCc" DOUBLE PRECISION NOT NULL,
    "estimatedAuFineness" DOUBLE PRECISION NOT NULL,
    "estimatedAgFineness" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "fineGoldGrams" DOUBLE PRECISION NOT NULL,
    "fineSilverGrams" DOUBLE PRECISION NOT NULL,
    "goldSpotUsdPerGram" DOUBLE PRECISION NOT NULL,
    "silverSpotUsdPerGram" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "grossMarketValueUsd" DOUBLE PRECISION NOT NULL,
    "royaltyDueUsd" DOUBLE PRECISION NOT NULL,
    "royaltyDueAngel" INTEGER NOT NULL,
    "stateShareDueAngel" INTEGER NOT NULL,
    "hsmSignature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POURED',
    "refinedBatchNumber" TEXT,
    "pouredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmeltingRunTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndustrialMiningConcession_concessionCode_key" ON "IndustrialMiningConcession"("concessionCode");

-- CreateIndex
CREATE INDEX "IndustrialMiningConcession_countryCode_idx" ON "IndustrialMiningConcession"("countryCode");

-- CreateIndex
CREATE INDEX "IndustrialMiningConcession_districtName_idx" ON "IndustrialMiningConcession"("districtName");

-- CreateIndex
CREATE INDEX "IndustrialMiningConcession_activeStatus_idx" ON "IndustrialMiningConcession"("activeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SmeltingRunTelemetry_runNumber_key" ON "SmeltingRunTelemetry"("runNumber");

-- CreateIndex
CREATE INDEX "SmeltingRunTelemetry_concessionCode_idx" ON "SmeltingRunTelemetry"("concessionCode");

-- CreateIndex
CREATE INDEX "SmeltingRunTelemetry_status_idx" ON "SmeltingRunTelemetry"("status");

-- CreateIndex
CREATE INDEX "SmeltingRunTelemetry_pouredAt_idx" ON "SmeltingRunTelemetry"("pouredAt");

-- AddForeignKey
ALTER TABLE "SmeltingRunTelemetry" ADD CONSTRAINT "SmeltingRunTelemetry_concessionId_fkey" FOREIGN KEY ("concessionId") REFERENCES "IndustrialMiningConcession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
