-- CreateTable
CREATE TABLE "IntegrityAttestation" (
    "id" TEXT NOT NULL,
    "attestationId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "supplyConsistent" BOOLEAN NOT NULL,
    "fractionalConsistent" BOOLEAN NOT NULL,
    "lpInvariantOk" BOOLEAN NOT NULL,
    "pendingReviewStale" INTEGER NOT NULL DEFAULT 0,
    "settledTotalCredited" INTEGER NOT NULL DEFAULT 0,
    "settledTotalRows" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB,
    "prevAttestationHash" TEXT,
    "attestationHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrityAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrityAttestation_attestationId_key" ON "IntegrityAttestation"("attestationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrityAttestation_attestationHash_key" ON "IntegrityAttestation"("attestationHash");

-- CreateIndex
CREATE INDEX "IntegrityAttestation_checkedAt_idx" ON "IntegrityAttestation"("checkedAt");

-- CreateIndex
CREATE INDEX "IntegrityAttestation_ok_idx" ON "IntegrityAttestation"("ok");