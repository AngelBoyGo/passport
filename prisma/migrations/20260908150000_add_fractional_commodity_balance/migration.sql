-- CreateTable
CREATE TABLE "FractionalCommodityBalance" (
    "id" TEXT NOT NULL,
    "subjectCommitment" TEXT NOT NULL,
    "commoditySymbol" TEXT NOT NULL,
    "milliUnits" INTEGER NOT NULL DEFAULT 0,
    "earnedTotal" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FractionalCommodityBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FractionalCommodityBalance_subjectCommitment_commoditySymbol_key" ON "FractionalCommodityBalance"("subjectCommitment", "commoditySymbol");

-- CreateIndex
CREATE INDEX "FractionalCommodityBalance_subjectCommitment_idx" ON "FractionalCommodityBalance"("subjectCommitment");

-- CreateIndex
CREATE INDEX "FractionalCommodityBalance_commoditySymbol_idx" ON "FractionalCommodityBalance"("commoditySymbol");