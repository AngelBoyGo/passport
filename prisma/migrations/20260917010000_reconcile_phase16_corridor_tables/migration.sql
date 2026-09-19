-- Phase 40 corrective migration: reconcile Phase-16 diplomatic corridor tables that were
-- never captured by a tracked migration (they predate the Prisma migration workflow and were
-- only ever applied via `db push` in the historical Phase-16 deployment).
--
-- This migration is generated from `prisma migrate diff` (live DB -> datamodel) so the ledger,
-- the schema, and production reality come into exact agreement. It is idempotent-safe for a
-- fresh DB (the tables simply do not exist there yet) and re-applies on the live DB where the
-- corridor tables have been missing since Phase 16.

-- DropIndex
DROP INDEX "RailSignerKey_railKey_publicKey_idx";

-- DropIndex
DROP INDEX "RailSignerKey_railKey_validFrom_idx";

-- DropIndex
DROP INDEX "SwarmMemory_payloadDigest_idx";

-- AlterTable
ALTER TABLE "ComputePurchase" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "TransitShipment" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "manifestNumber" TEXT NOT NULL,
    "commodityType" TEXT NOT NULL DEFAULT 'GOLD',
    "fineUnits" DOUBLE PRECISION NOT NULL,
    "originJurisdiction" TEXT NOT NULL,
    "destinationJurisdiction" TEXT NOT NULL,
    "routeCode" TEXT NOT NULL,
    "escortPublicKey" TEXT NOT NULL,
    "containerSealDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
    "checkpointsCleared" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransitShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsCheckpoint" (
    "id" TEXT NOT NULL,
    "checkpointCode" TEXT NOT NULL,
    "checkpointName" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "inspectorPublicKey" TEXT NOT NULL,
    "activeStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalFeesCollectedAngel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorderTaxSettlement" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "grossValueUsd" DOUBLE PRECISION NOT NULL,
    "tariffAngel" INTEGER NOT NULL,
    "hostCustomsAngel" INTEGER NOT NULL,
    "corridorPoolAngel" INTEGER NOT NULL,
    "treasuryAngel" INTEGER NOT NULL,
    "tariffRateBps" INTEGER NOT NULL DEFAULT 75,
    "clearedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorderTaxSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransitShipment_shipmentId_key" ON "TransitShipment"("shipmentId");

-- CreateIndex
CREATE INDEX "TransitShipment_commodityType_idx" ON "TransitShipment"("commodityType");

-- CreateIndex
CREATE INDEX "TransitShipment_originJurisdiction_idx" ON "TransitShipment"("originJurisdiction");

-- CreateIndex
CREATE INDEX "TransitShipment_status_idx" ON "TransitShipment"("status");

-- CreateIndex
CREATE INDEX "TransitShipment_createdAt_idx" ON "TransitShipment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsCheckpoint_checkpointCode_key" ON "CustomsCheckpoint"("checkpointCode");

-- CreateIndex
CREATE INDEX "CustomsCheckpoint_jurisdiction_idx" ON "CustomsCheckpoint"("jurisdiction");

-- CreateIndex
CREATE INDEX "CustomsCheckpoint_activeStatus_idx" ON "CustomsCheckpoint"("activeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BorderTaxSettlement_settlementId_key" ON "BorderTaxSettlement"("settlementId");

-- CreateIndex
CREATE INDEX "BorderTaxSettlement_shipmentId_idx" ON "BorderTaxSettlement"("shipmentId");

-- CreateIndex
CREATE INDEX "BorderTaxSettlement_checkpointId_idx" ON "BorderTaxSettlement"("checkpointId");

-- CreateIndex
CREATE INDEX "BorderTaxSettlement_clearedAt_idx" ON "BorderTaxSettlement"("clearedAt");

-- CreateIndex
CREATE INDEX "RailSettlement_settlementId_idx" ON "RailSettlement"("settlementId");

-- CreateIndex
CREATE INDEX "RailSignerKey_railKey_validFrom_idx" ON "RailSignerKey"("railKey", "validFrom");

-- CreateIndex
CREATE INDEX "RailSignerKey_railKey_publicKey_idx" ON "RailSignerKey"("railKey", "publicKey");

-- AddForeignKey
ALTER TABLE "BorderTaxSettlement" ADD CONSTRAINT "BorderTaxSettlement_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "TransitShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorderTaxSettlement" ADD CONSTRAINT "BorderTaxSettlement_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "CustomsCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "FractionalCommodityBalance_subjectCommitment_commoditySymbol_ke" RENAME TO "FractionalCommodityBalance_subjectCommitment_commoditySymbo_key";
