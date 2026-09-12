-- CreateTable: agent-signed intent nonces (Phase 31) — DB-unique replay guard for value routes.
CREATE TABLE "AgentIntentNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentIntentNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentIntentNonce_nonce_key" ON "AgentIntentNonce"("nonce");
CREATE INDEX "AgentIntentNonce_agentCommitment_idx" ON "AgentIntentNonce"("agentCommitment");
CREATE INDEX "AgentIntentNonce_expiresAt_idx" ON "AgentIntentNonce"("expiresAt");
