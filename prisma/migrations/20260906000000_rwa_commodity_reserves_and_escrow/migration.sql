-- CreateTable
CREATE TABLE "CommodityReserve" (
    "id" TEXT NOT NULL,
    "commodityType" TEXT NOT NULL DEFAULT 'GOLD',
    "symbol" TEXT NOT NULL DEFAULT 'Au',
    "totalGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFineGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeLotsCount" INTEGER NOT NULL DEFAULT 0,
    "latestMerkleRoot" TEXT,
    "lastAuditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommodityReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "reserveId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "custodianName" TEXT NOT NULL,
    "locationCity" TEXT NOT NULL,
    "locationCountry" TEXT NOT NULL,
    "barSerials" TEXT[],
    "grossWeightGrams" DOUBLE PRECISION NOT NULL,
    "fineness" DOUBLE PRECISION NOT NULL,
    "fineWeightGrams" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AUDITED',
    "leafHash" TEXT,
    "assayRef" TEXT,
    "metadata" JSONB,
    "auditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssayerCertification" (
    "id" TEXT NOT NULL,
    "certificationNumber" TEXT NOT NULL,
    "assayerName" TEXT NOT NULL,
    "assayerPublicKey" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "methodology" TEXT NOT NULL,
    "purityFineness" DOUBLE PRECISION NOT NULL,
    "grossGrams" DOUBLE PRECISION NOT NULL,
    "sampleSignature" TEXT NOT NULL,
    "notes" TEXT,
    "certifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssayerCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommodityEscrow" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "buyerCommitment" TEXT NOT NULL,
    "sellerCommitment" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "commodityType" TEXT NOT NULL DEFAULT 'GOLD',
    "fineGrams" DOUBLE PRECISION NOT NULL,
    "unitPriceUsd" DOUBLE PRECISION NOT NULL,
    "lockedAngel" INTEGER NOT NULL,
    "protocolFeeAngel" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "assayCertificationNumber" TEXT,
    "releaseSignature" TEXT,
    "timeoutAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommodityEscrow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommodityReserve_commodityType_symbol_key" ON "CommodityReserve"("commodityType", "symbol");

-- CreateIndex
CREATE INDEX "CommodityReserve_commodityType_idx" ON "CommodityReserve"("commodityType");

-- CreateIndex
CREATE UNIQUE INDEX "VaultBatch_batchNumber_key" ON "VaultBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "VaultBatch_reserveId_idx" ON "VaultBatch"("reserveId");

-- CreateIndex
CREATE INDEX "VaultBatch_vaultId_idx" ON "VaultBatch"("vaultId");

-- CreateIndex
CREATE INDEX "VaultBatch_status_idx" ON "VaultBatch"("status");

-- CreateIndex
CREATE INDEX "VaultBatch_locationCountry_idx" ON "VaultBatch"("locationCountry");

-- CreateIndex
CREATE UNIQUE INDEX "AssayerCertification_certificationNumber_key" ON "AssayerCertification"("certificationNumber");

-- CreateIndex
CREATE INDEX "AssayerCertification_batchNumber_idx" ON "AssayerCertification"("batchNumber");

-- CreateIndex
CREATE INDEX "AssayerCertification_assayerPublicKey_idx" ON "AssayerCertification"("assayerPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommodityEscrow_escrowId_key" ON "CommodityEscrow"("escrowId");

-- CreateIndex
CREATE INDEX "CommodityEscrow_buyerCommitment_idx" ON "CommodityEscrow"("buyerCommitment");

-- CreateIndex
CREATE INDEX "CommodityEscrow_sellerCommitment_idx" ON "CommodityEscrow"("sellerCommitment");

-- CreateIndex
CREATE INDEX "CommodityEscrow_batchNumber_idx" ON "CommodityEscrow"("batchNumber");

-- CreateIndex
CREATE INDEX "CommodityEscrow_status_idx" ON "CommodityEscrow"("status");

-- CreateIndex
CREATE INDEX "CommodityEscrow_timeoutAt_idx" ON "CommodityEscrow"("timeoutAt");

-- AddForeignKey
ALTER TABLE "VaultBatch" ADD CONSTRAINT "VaultBatch_reserveId_fkey" FOREIGN KEY ("reserveId") REFERENCES "CommodityReserve"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
