-- AlterTable: add an optional UNIQUE idempotency key so duplicate credits
-- (retries / concurrent requests) fail with P2002 instead of double-minting.
ALTER TABLE "OperatorLedgerEntry" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OperatorLedgerEntry_idempotencyKey_key" ON "OperatorLedgerEntry"("idempotencyKey");
