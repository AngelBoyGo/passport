-- CreateTable
CREATE TABLE "MoneyIntent" (
    "id" TEXT NOT NULL,
    "intentKind" TEXT NOT NULL,
    "requesterCommitment" TEXT,
    "workerCommitment" TEXT,
    "amountAngels" DOUBLE PRECISION NOT NULL,
    "intentDigest" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "cycleRef" TEXT,
    "reason" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneyIntent_intentDigest_key" ON "MoneyIntent"("intentDigest");

-- CreateIndex
CREATE INDEX "MoneyIntent_status_idx" ON "MoneyIntent"("status");

-- CreateIndex
CREATE INDEX "MoneyIntent_workerCommitment_status_idx" ON "MoneyIntent"("workerCommitment", "status");
