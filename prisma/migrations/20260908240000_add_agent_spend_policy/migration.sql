-- CreateTable: autonomous agent spend policies (Phase 32) — hard caps for unattended spending.
CREATE TABLE "AgentSpendPolicy" (
    "id" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "perTxMaxAngel" INTEGER NOT NULL DEFAULT 0,
    "dailyMaxAngel" INTEGER NOT NULL DEFAULT 0,
    "weeklyMaxAngel" INTEGER NOT NULL DEFAULT 0,
    "counterpartyAllowlist" JSONB,
    "domainAllowlist" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSpendPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSpendPolicy_agentCommitment_key" ON "AgentSpendPolicy"("agentCommitment");
CREATE INDEX "AgentSpendPolicy_enabled_idx" ON "AgentSpendPolicy"("enabled");
