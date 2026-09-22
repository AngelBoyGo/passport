-- AlterTable
ALTER TABLE "AgentInstance" ADD COLUMN     "lastSweepAt" TIMESTAMP(3),
ADD COLUMN     "reputationTier" TEXT;
