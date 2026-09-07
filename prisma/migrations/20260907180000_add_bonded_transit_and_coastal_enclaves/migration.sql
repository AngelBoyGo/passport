-- CreateTable
CREATE TABLE "CoastalPortEnclave" (
    "id" TEXT NOT NULL,
    "portCode" TEXT NOT NULL,
    "portName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "customsAuthorityName" TEXT NOT NULL,
    "enclavePublicKey" TEXT NOT NULL,
    "clearingFeeShareBps" INTEGER NOT NULL DEFAULT 50,
    "totalTransitGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFeesEarnedAngel" INTEGER NOT NULL DEFAULT 0,
    "activeStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoastalPortEnclave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BondedTransitWaybill" (
    "id" TEXT NOT NULL,
    "waybillNumber" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "enclaveId" TEXT NOT NULL,
    "destinationPortCode" TEXT NOT NULL,
    "originVaultId" TEXT NOT NULL,
    "carrierCommitment" TEXT NOT NULL,
    "carrierBondAngel" INTEGER NOT NULL DEFAULT 5000,
    "grossWeightGrams" DOUBLE PRECISION NOT NULL,
    "fineGoldGrams" DOUBLE PRECISION NOT NULL,
    "diplomaticSealDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
    "checkpointsVisited" TEXT[],
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "slashedAt" TIMESTAMP(3),

    CONSTRAINT "BondedTransitWaybill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoastalPortEnclave_portCode_key" ON "CoastalPortEnclave"("portCode");

-- CreateIndex
CREATE INDEX "CoastalPortEnclave_countryCode_idx" ON "CoastalPortEnclave"("countryCode");

-- CreateIndex
CREATE INDEX "CoastalPortEnclave_activeStatus_idx" ON "CoastalPortEnclave"("activeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BondedTransitWaybill_waybillNumber_key" ON "BondedTransitWaybill"("waybillNumber");

-- CreateIndex
CREATE INDEX "BondedTransitWaybill_batchNumber_idx" ON "BondedTransitWaybill"("batchNumber");

-- CreateIndex
CREATE INDEX "BondedTransitWaybill_carrierCommitment_idx" ON "BondedTransitWaybill"("carrierCommitment");

-- CreateIndex
CREATE INDEX "BondedTransitWaybill_destinationPortCode_idx" ON "BondedTransitWaybill"("destinationPortCode");

-- CreateIndex
CREATE INDEX "BondedTransitWaybill_status_idx" ON "BondedTransitWaybill"("status");

-- CreateIndex
CREATE INDEX "BondedTransitWaybill_dispatchedAt_idx" ON "BondedTransitWaybill"("dispatchedAt");

-- AddForeignKey
ALTER TABLE "BondedTransitWaybill" ADD CONSTRAINT "BondedTransitWaybill_enclaveId_fkey" FOREIGN KEY ("enclaveId") REFERENCES "CoastalPortEnclave"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
