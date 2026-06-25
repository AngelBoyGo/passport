-- CreateEnum
CREATE TYPE "OperatorAccountStatus" AS ENUM ('ACTIVE', 'ESCROW_INSOLVENT_BLOCKED');

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "stakeBalanceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "accountStatus" "OperatorAccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "SlashingLedger" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "penaltyCents" INTEGER NOT NULL,
    "tranche" "ErrorTranche" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlashingLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlashingLedger_operatorId_idx" ON "SlashingLedger"("operatorId");

-- AddForeignKey
ALTER TABLE "SlashingLedger" ADD CONSTRAINT "SlashingLedger_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
