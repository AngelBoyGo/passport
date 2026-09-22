-- AlterTable
ALTER TABLE "MoneyIntent" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MoneyIntent_status_lastAttemptAt_idx" ON "MoneyIntent"("status", "lastAttemptAt");
