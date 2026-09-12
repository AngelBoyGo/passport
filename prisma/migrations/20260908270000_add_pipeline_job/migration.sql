-- Phase 36: data-pipeline jobs (external revenue linkage).

CREATE TABLE "PipelineJob" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "agentCommitment" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "inputRef" TEXT NOT NULL,
    "outputDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),

    CONSTRAINT "PipelineJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PipelineJob_jobId_key" ON "PipelineJob"("jobId");
CREATE UNIQUE INDEX "PipelineJob_externalRef_key" ON "PipelineJob"("externalRef");
CREATE INDEX "PipelineJob_agentCommitment_idx" ON "PipelineJob"("agentCommitment");
CREATE INDEX "PipelineJob_status_idx" ON "PipelineJob"("status");
