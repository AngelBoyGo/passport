-- Phase 37: Command Brain persistent memory.

CREATE TABLE "BrainMemory" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "action" TEXT,
    "actionResult" TEXT,
    "healthScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrainMemory_kind_idx" ON "BrainMemory"("kind");
CREATE INDEX "BrainMemory_createdAt_idx" ON "BrainMemory"("createdAt");