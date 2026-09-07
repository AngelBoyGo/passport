-- CreateTable
CREATE TABLE "ArtisanalBuyingStation" (
    "id" TEXT NOT NULL,
    "stationCode" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "operatorCommitment" TEXT NOT NULL,
    "stationPublicKey" TEXT NOT NULL,
    "bondedStakeAngel" INTEGER NOT NULL DEFAULT 5000,
    "activeStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalPurchasedGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPaidAngel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtisanalBuyingStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OreIntakeReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "stationCode" TEXT NOT NULL,
    "minerCommitment" TEXT NOT NULL,
    "grossWeightGrams" DOUBLE PRECISION NOT NULL,
    "assayedFineness" DOUBLE PRECISION NOT NULL,
    "fineGoldGrams" DOUBLE PRECISION NOT NULL,
    "spotPriceUsdPerGram" DOUBLE PRECISION NOT NULL,
    "payoutRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 95.0,
    "payoutUsd" DOUBLE PRECISION NOT NULL,
    "payoutAngel" INTEGER NOT NULL,
    "spectrometerSignature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PURCHASED',
    "transferredBatchNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OreIntakeReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtisanalBuyingStation_stationCode_key" ON "ArtisanalBuyingStation"("stationCode");

-- CreateIndex
CREATE INDEX "ArtisanalBuyingStation_countryCode_idx" ON "ArtisanalBuyingStation"("countryCode");

-- CreateIndex
CREATE INDEX "ArtisanalBuyingStation_districtName_idx" ON "ArtisanalBuyingStation"("districtName");

-- CreateIndex
CREATE INDEX "ArtisanalBuyingStation_activeStatus_idx" ON "ArtisanalBuyingStation"("activeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "OreIntakeReceipt_receiptNumber_key" ON "OreIntakeReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "OreIntakeReceipt_stationCode_idx" ON "OreIntakeReceipt"("stationCode");

-- CreateIndex
CREATE INDEX "OreIntakeReceipt_minerCommitment_idx" ON "OreIntakeReceipt"("minerCommitment");

-- CreateIndex
CREATE INDEX "OreIntakeReceipt_status_idx" ON "OreIntakeReceipt"("status");

-- CreateIndex
CREATE INDEX "OreIntakeReceipt_createdAt_idx" ON "OreIntakeReceipt"("createdAt");

-- AddForeignKey
ALTER TABLE "OreIntakeReceipt" ADD CONSTRAINT "OreIntakeReceipt_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "ArtisanalBuyingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
