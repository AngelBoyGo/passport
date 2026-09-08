-- AlterTable: add the authorized Ed25519 signer commitment to RailSpec (Phase 21).
ALTER TABLE "RailSpec" ADD COLUMN "signerCommitment" TEXT;

-- CreateTable
CREATE TABLE "RailSettlement" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "railKey" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "signerCommitment" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fxRateUsd" DOUBLE PRECISION,
    "creditedAngel" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorTranche" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "RailSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RailSettlement_settlementId_key" ON "RailSettlement"("settlementId");

-- CreateIndex (idempotency guard: one settlement per railKey+reference)
CREATE UNIQUE INDEX "RailSettlement_railKey_reference_key" ON "RailSettlement"("railKey", "reference");

-- CreateIndex
CREATE INDEX "RailSettlement_status_idx" ON "RailSettlement"("status");
CREATE INDEX "RailSettlement_railKey_idx" ON "RailSettlement"("railKey");