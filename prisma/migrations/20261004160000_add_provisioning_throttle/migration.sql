-- CreateTable: persistent provisioning throttle (Sybil resistance)
CREATE TABLE "ProvisioningThrottle" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningThrottle_scope_key_windowStart_key" ON "ProvisioningThrottle"("scope", "key", "windowStart");

-- CreateIndex
CREATE INDEX "ProvisioningThrottle_scope_windowStart_idx" ON "ProvisioningThrottle"("scope", "windowStart");
