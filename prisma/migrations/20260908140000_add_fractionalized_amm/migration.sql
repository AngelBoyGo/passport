-- CreateTable
CREATE TABLE "CommodityLiquidityPool" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "pairSymbol" TEXT NOT NULL,
    "commoditySymbol" TEXT NOT NULL,
    "angelReserve" INTEGER NOT NULL DEFAULT 0,
    "commodityReserve" INTEGER NOT NULL DEFAULT 0,
    "totalLpTokens" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommodityLiquidityPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmmSwapReceipt" (
    "id" TEXT NOT NULL,
    "swapId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "inputToken" TEXT NOT NULL,
    "inputAmount" INTEGER NOT NULL,
    "outputToken" TEXT NOT NULL,
    "outputAmount" INTEGER NOT NULL,
    "feeAngel" INTEGER NOT NULL DEFAULT 0,
    "oracleSpotUsd" DOUBLE PRECISION NOT NULL,
    "effectivePriceUsd" DOUBLE PRECISION NOT NULL,
    "deviationPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regimeAtSwap" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmmSwapReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommodityLiquidityPool_poolId_key" ON "CommodityLiquidityPool"("poolId");

-- CreateIndex
CREATE INDEX "CommodityLiquidityPool_pairSymbol_idx" ON "CommodityLiquidityPool"("pairSymbol");

-- CreateIndex
CREATE INDEX "CommodityLiquidityPool_status_idx" ON "CommodityLiquidityPool"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AmmSwapReceipt_swapId_key" ON "AmmSwapReceipt"("swapId");

-- CreateIndex
CREATE INDEX "AmmSwapReceipt_poolId_idx" ON "AmmSwapReceipt"("poolId");

-- CreateIndex
CREATE INDEX "AmmSwapReceipt_agentCommitment_idx" ON "AmmSwapReceipt"("agentCommitment");

-- CreateIndex
CREATE INDEX "AmmSwapReceipt_createdAt_idx" ON "AmmSwapReceipt"("createdAt");

-- AddForeignKey
ALTER TABLE "AmmSwapReceipt" ADD CONSTRAINT "AmmSwapReceipt_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "CommodityLiquidityPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;