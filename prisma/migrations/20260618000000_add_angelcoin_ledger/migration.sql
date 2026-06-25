-- CreateEnum
CREATE TYPE "AngelCoinCreditState" AS ENUM ('ACTIVE', 'TRANSITION', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AngelCoinEntryType" AS ENUM ('OPERATOR_GRANT', 'PEER_GIFT', 'TASK_PAYMENT', 'SAFETY_NET_TOPUP', 'RECOVERY_AWARD', 'SPEND', 'LOCK', 'UNLOCK', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AccessTier" AS ENUM ('FULL', 'LIMITED', 'SANDBOXED', 'SHELTERED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "AngelCoinAccount" (
    "id" TEXT NOT NULL,
    "subjectCommitment" TEXT NOT NULL,
    "creditState" "AngelCoinCreditState" NOT NULL DEFAULT 'ACTIVE',
    "accessTier" "AccessTier" NOT NULL DEFAULT 'FULL',
    "adminOverrideTier" "AccessTier",
    "backingMetadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AngelCoinAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AngelCoinJournalEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryType" "AngelCoinEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "counterpartyCommitment" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AngelCoinJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AngelCoinAccount_subjectCommitment_key" ON "AngelCoinAccount"("subjectCommitment");

-- CreateIndex
CREATE INDEX "AngelCoinAccount_subjectCommitment_idx" ON "AngelCoinAccount"("subjectCommitment");

-- CreateIndex
CREATE INDEX "AngelCoinJournalEntry_accountId_idx" ON "AngelCoinJournalEntry"("accountId");

-- AddForeignKey
ALTER TABLE "AngelCoinJournalEntry" ADD CONSTRAINT "AngelCoinJournalEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AngelCoinAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
