-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "thesis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "originPersona" TEXT NOT NULL DEFAULT 'mars',
    "keyResults" JSONB,
    "evidenceRefs" JSONB,
    "currentPlanId" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'command_brain',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionPlan" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "cycleId" TEXT,
    "horizon" TEXT NOT NULL DEFAULT 'DAILY',
    "steps" JSONB,
    "dialogue" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByPersona" TEXT NOT NULL DEFAULT 'muse',
    "committedStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoltbookItem" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "sourceUrl" TEXT,
    "injectionScan" JSONB,
    "trustLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoltbookItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mission_missionId_key" ON "Mission"("missionId");

-- CreateIndex
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

-- CreateIndex
CREATE INDEX "Mission_priority_idx" ON "Mission"("priority");

-- CreateIndex
CREATE INDEX "Mission_createdAt_idx" ON "Mission"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MissionPlan_planId_key" ON "MissionPlan"("planId");

-- CreateIndex
CREATE INDEX "MissionPlan_missionId_idx" ON "MissionPlan"("missionId");

-- CreateIndex
CREATE INDEX "MissionPlan_status_idx" ON "MissionPlan"("status");

-- CreateIndex
CREATE INDEX "MissionPlan_createdAt_idx" ON "MissionPlan"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoltbookItem_contentHash_key" ON "MoltbookItem"("contentHash");

-- CreateIndex
CREATE INDEX "MoltbookItem_kind_idx" ON "MoltbookItem"("kind");

-- CreateIndex
CREATE INDEX "MoltbookItem_seenAt_idx" ON "MoltbookItem"("seenAt");
