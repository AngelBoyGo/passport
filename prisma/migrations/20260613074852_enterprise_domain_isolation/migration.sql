-- CreateEnum
CREATE TYPE "ErrorTranche" AS ENUM ('DATA_LEAKAGE', 'COMPUTE_TIMEOUT', 'LOGIC_DETECTION', 'SLA_BREACH', 'NONE');

-- CreateEnum
CREATE TYPE "OperationalDomain" AS ENUM ('FINANCIAL_CLEARING', 'CUSTOMER_SUPPORT', 'CODE_GENERATION', 'SYSTEM_INTEGRATION');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "domain" "OperationalDomain",
ADD COLUMN     "errorTranche" "ErrorTranche" DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "Receipt_operatorId_domain_idx" ON "Receipt"("operatorId", "domain");
