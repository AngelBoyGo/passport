#!/usr/bin/env bash
# droplet-ship-migrations.sh — ship and apply the three pending migrations on the
# production droplet (container-only host: no git, no node/npm).
#
# Creates the migration files that predate the droplet's prisma folder, applies
# them via the node:20-alpine container, then verifies the ledger and tables.
#
# Migrations applied:
#   20260917010000_reconcile_phase16_corridor_tables
#   20260918000000_add_brain_lease
#   20260919000000_add_improvement_proposals_and_replays

set -e
cd /home/deploy/passport
set -a; source .env; set +a

mkdir -p prisma/migrations/20260917010000_reconcile_phase16_corridor_tables \
         prisma/migrations/20260918000000_add_brain_lease \
         prisma/migrations/20260919000000_add_improvement_proposals_and_replays

# ── 1. Corridor reconciliation (Phase 16 tables never captured by a migration) ──
cat > prisma/migrations/20260917010000_reconcile_phase16_corridor_tables/migration.sql <<'MIGEOF'
-- Phase 40 corrective migration: reconcile Phase-16 diplomatic corridor tables that were
-- never captured by a tracked migration (they predate the Prisma migration workflow and were
-- only ever applied via `db push` in the historical Phase-16 deployment).
--
-- This migration is generated from `prisma migrate diff` (live DB -> datamodel) so the ledger,
-- the schema, and production reality come into exact agreement.

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
MIGEOF

# ── 2. Brain lease (distributed single-flight) ──
cat > prisma/migrations/20260918000000_add_brain_lease/migration.sql <<'MIGEOF'
-- CreateTable
CREATE TABLE "BrainLease" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainLease_pkey" PRIMARY KEY ("id")
);
MIGEOF

# ── 3. Improvement proposals + replay runs (controlled advancement) ──
cat > prisma/migrations/20260919000000_add_improvement_proposals_and_replays/migration.sql <<'MIGEOF'
-- CreateTable
CREATE TABLE "ImprovementProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "expectedImprovement" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "sourceScanId" TEXT,
    "params" JSONB,
    "replayId" TEXT,
    "replayScore" DOUBLE PRECISION,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayRun" (
    "id" TEXT NOT NULL,
    "replayId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 7,
    "cyclesCompared" INTEGER NOT NULL DEFAULT 0,
    "decisionMatches" INTEGER NOT NULL DEFAULT 0,
    "negativeAvoided" INTEGER NOT NULL DEFAULT 0,
    "positiveDisplaced" INTEGER NOT NULL DEFAULT 0,
    "unknownDiffs" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementProposal_proposalId_key" ON "ImprovementProposal"("proposalId");

-- CreateIndex
CREATE INDEX "ImprovementProposal_status_idx" ON "ImprovementProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayRun_replayId_key" ON "ReplayRun"("replayId");

-- CreateIndex
CREATE INDEX "ReplayRun_proposalId_idx" ON "ReplayRun"("proposalId");
MIGEOF

echo "=== migrations written ==="
wc -l prisma/migrations/20260917*/migration.sql \
      prisma/migrations/20260918*/migration.sql \
      prisma/migrations/20260919*/migration.sql

echo "=== applying via node container ==="
docker run --rm --network passport_default \
  -v /home/deploy/passport/prisma:/app/prisma -w /app \
  -e DATABASE_URL="postgresql://passport:${POSTGRES_PASSWORD}@db:5432/passport?schema=public" \
  node:20-alpine sh -c "npx --yes prisma@6.19.0 migrate deploy 2>&1 | grep -Ev 'npm (notice|warn)' | tail -8"

echo "=== ledger: last 5 migrations ==="
docker exec passport_db_1 psql -U passport -d passport -c \
  "SELECT migration_name FROM \"_prisma_migrations\" ORDER BY migration_name DESC LIMIT 5;"

echo "=== tables: the six new tables must all appear ==="
docker exec passport_db_1 psql -U passport -d passport -c "\dt" \
  | grep -E "BrainLease|ImprovementProposal|ReplayRun|TransitShipment|CustomsCheckpoint|BorderTaxSettlement"

echo "=== DONE: ledger, schema, and production reality agree ==="