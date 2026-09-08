-- CreateTable
CREATE TABLE "RailSpec" (
    "id" TEXT NOT NULL,
    "railKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "ledgerKind" TEXT NOT NULL,
    "kycTier" TEXT NOT NULL DEFAULT 'NONE',
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "endpoints" JSONB,
    "idempotencyKeyPath" TEXT,
    "fxActor" JSONB,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'PROPOSED',
    "blueprintId" TEXT,
    "authorCommitment" TEXT NOT NULL,
    "authorizedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RailSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RailCandidate" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rationale" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "proposedBlueprintId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RailCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RailTelemetry" (
    "id" TEXT NOT NULL,
    "railKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "volumeUnits" INTEGER NOT NULL DEFAULT 0,
    "dedupeHits" INTEGER NOT NULL DEFAULT 0,
    "errorTranche" TEXT NOT NULL DEFAULT 'NONE',
    "settlementCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RailTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RailRunbook" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "sampleSpecs" JSONB NOT NULL,
    "generalization" JSONB,
    "successMetrics" JSONB,
    "promotedFromCandidateId" TEXT,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RailRunbook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RailSpec_railKey_key" ON "RailSpec"("railKey");
CREATE INDEX "RailSpec_state_idx" ON "RailSpec"("state");
CREATE INDEX "RailSpec_category_idx" ON "RailSpec"("category");
CREATE INDEX "RailSpec_blueprintId_idx" ON "RailSpec"("blueprintId");

-- CreateIndex
CREATE UNIQUE INDEX "RailCandidate_fingerprint_key" ON "RailCandidate"("fingerprint");
CREATE INDEX "RailCandidate_source_idx" ON "RailCandidate"("source");
CREATE INDEX "RailCandidate_score_idx" ON "RailCandidate"("score");

-- CreateIndex
CREATE INDEX "RailTelemetry_railKey_seq_idx" ON "RailTelemetry"("railKey", "seq");
CREATE INDEX "RailTelemetry_errorTranche_idx" ON "RailTelemetry"("errorTranche");

-- CreateIndex
CREATE UNIQUE INDEX "RailRunbook_blueprintId_key" ON "RailRunbook"("blueprintId");
CREATE INDEX "RailRunbook_automated_idx" ON "RailRunbook"("automated");