-- CreateTable
CREATE TABLE "SovereignIndustrialProject" (
    "id" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FUNDED',
    "allocatedAngel" INTEGER NOT NULL,
    "totalMilestones" INTEGER NOT NULL DEFAULT 3,
    "completedMilestones" INTEGER NOT NULL DEFAULT 0,
    "expectedJobs" INTEGER NOT NULL DEFAULT 10,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "declaredImpactKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realizedImpactKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SovereignIndustrialProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StabilizationDisbursement" (
    "id" TEXT NOT NULL,
    "disbursementId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneNumber" INTEGER NOT NULL DEFAULT 1,
    "amountAngel" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verificationMediaDigest" TEXT NOT NULL,
    "verificationDescription" TEXT,
    "verifierSignature" TEXT NOT NULL,
    "disbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StabilizationDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SovereignIndustrialProject_projectCode_key" ON "SovereignIndustrialProject"("projectCode");

-- CreateIndex
CREATE INDEX "SovereignIndustrialProject_category_idx" ON "SovereignIndustrialProject"("category");

-- CreateIndex
CREATE INDEX "SovereignIndustrialProject_countryCode_idx" ON "SovereignIndustrialProject"("countryCode");

-- CreateIndex
CREATE INDEX "SovereignIndustrialProject_status_idx" ON "SovereignIndustrialProject"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StabilizationDisbursement_disbursementId_key" ON "StabilizationDisbursement"("disbursementId");

-- CreateIndex
CREATE INDEX "StabilizationDisbursement_projectId_idx" ON "StabilizationDisbursement"("projectId");

-- CreateIndex
CREATE INDEX "StabilizationDisbursement_status_idx" ON "StabilizationDisbursement"("status");

-- AddForeignKey
ALTER TABLE "StabilizationDisbursement" ADD CONSTRAINT "StabilizationDisbursement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SovereignIndustrialProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;