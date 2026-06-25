-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "domainCommitment" TEXT,
ADD COLUMN     "blindSalt" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_operatorId_domainCommitment_idx" ON "Receipt"("operatorId", "domainCommitment");
