-- CreateTable
CREATE TABLE "ExecutionSafetyFlag" (
    "id" TEXT NOT NULL,
    "liveExecutionHalted" BOOLEAN NOT NULL DEFAULT false,
    "haltedAt" TIMESTAMP(3),
    "reason" TEXT,
    "causedByAttestationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionSafetyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RailSignerKey" (
    "id" TEXT NOT NULL,
    "railKey" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RailSignerKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachResponse" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "causedByAttestationId" TEXT NOT NULL,
    "halted" BOOLEAN NOT NULL,
    "quarantinedRails" TEXT[],
    "at" TIMESTAMP(3) NOT NULL,
    "attestationHash" TEXT NOT NULL,
    "prevAttestationHash" TEXT,
    "signature" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreachResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RailSignerKey_railKey_validFrom_idx" ON "RailSignerKey"("railKey", "validFrom");
CREATE UNIQUE INDEX "RailSignerKey_railKey_publicKey_idx" ON "RailSignerKey"("railKey", "publicKey");
CREATE UNIQUE INDEX "BreachResponse_responseId_key" ON "BreachResponse"("responseId");
CREATE INDEX "BreachResponse_causedByAttestationId_idx" ON "BreachResponse"("causedByAttestationId");
CREATE INDEX "BreachResponse_at_idx" ON "BreachResponse"("at");