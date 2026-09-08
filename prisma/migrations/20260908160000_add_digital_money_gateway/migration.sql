-- CreateTable
CREATE TABLE "MoneySettlement" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "xofAmount" INTEGER NOT NULL,
    "xofRateUsd" DOUBLE PRECISION NOT NULL,
    "creditedAngel" INTEGER NOT NULL,
    "targetCommitment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SETTLED',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "MoneySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiatFix" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateUsdPerUnit" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiatFix_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneySettlement_provider_externalRef_key" ON "MoneySettlement"("provider", "externalRef");

-- CreateIndex
CREATE INDEX "MoneySettlement_provider_idx" ON "MoneySettlement"("provider");

-- CreateIndex
CREATE INDEX "MoneySettlement_createdAt_idx" ON "MoneySettlement"("createdAt");

-- CreateIndex
CREATE INDEX "FiatFix_currency_validFrom_idx" ON "FiatFix"("currency", "validFrom");

-- CreateIndex
CREATE INDEX "FiatFix_currency_expiresAt_idx" ON "FiatFix"("currency", "expiresAt");