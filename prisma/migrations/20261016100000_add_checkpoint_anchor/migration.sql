-- CreateTable
CREATE TABLE "CheckpointAnchor" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receiptCount" INTEGER NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "previousCheckpointHash" TEXT,
    "contentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckpointAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckpointAnchor_checkpointId_key" ON "CheckpointAnchor"("checkpointId");

-- CreateIndex
CREATE INDEX "CheckpointAnchor_createdAt_idx" ON "CheckpointAnchor"("createdAt");
