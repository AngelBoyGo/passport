-- AlterTable
ALTER TABLE "AgentEnrollment" ADD COLUMN "photoUrl" TEXT,
ADD COLUMN "photoContentSha256" TEXT,
ADD COLUMN "photoMimeType" TEXT,
ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
