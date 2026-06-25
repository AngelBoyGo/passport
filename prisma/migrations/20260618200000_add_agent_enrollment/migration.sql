-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'ISSUED', 'REVOKED');

-- CreateTable
CREATE TABLE "AgentEnrollment" (
    "id" TEXT NOT NULL,
    "subjectCommitment" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "challengeNonce" TEXT,
    "challengeExpiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentEnrollment_subjectCommitment_key" ON "AgentEnrollment"("subjectCommitment");

-- CreateIndex
CREATE INDEX "AgentEnrollment_status_idx" ON "AgentEnrollment"("status");
