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
