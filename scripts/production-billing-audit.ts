/**
 * Live-fire production billing audit — injects checkout.session.completed against
 * active production Postgres (DATABASE_URL), asserts provisioning, then tears down.
 *
 * Run:
 *   set DATABASE_URL=postgresql://...
 *   npx tsx scripts/production-billing-audit.ts
 *
 * Required env:
 *   DATABASE_URL — active production Postgres connection string
 *
 * Safety:
 *   - Uses isolated Prisma interactive transactions for inject + assert + purge
 *   - Forensic rollback deletes audit operator before disconnect
 *   - Never prints raw API keys in logs (only prefix)
 */
import { PrismaClient } from "@prisma/client";
import {
  assertAuditProvisioning,
  buildAuditCheckoutEvent,
  generateAuditCustomerId,
  provisionAuditCheckout,
  purgeAuditOperator,
} from "../src/lib/billing-audit";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Missing required env var: DATABASE_URL\n\n" +
        "Example:\n" +
        "  set DATABASE_URL=postgresql://user:pass@host:5432/passport\n" +
        "  npx tsx scripts/production-billing-audit.ts"
    );
  }
  return url;
}

async function main() {
  const databaseUrl = requireDatabaseUrl();
  const customerId = generateAuditCustomerId();
  const eventId = `evt_live_audit_${Date.now()}`;
  const email = "billing-audit@passport.metis.gold";

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  console.log("=== Passport production billing audit ===\n");
  console.log(`Customer: ${customerId}`);
  console.log(`Event:    ${eventId}`);
  console.log(`Event payload type: ${buildAuditCheckoutEvent(customerId, eventId).type}\n`);

  try {
    console.log("[inject] Provisioning via isolated transaction...");
    const provision = await prisma.$transaction(async (tx) =>
      provisionAuditCheckout(tx, customerId, email, eventId)
    );

    if (provision.duplicate) {
      throw new Error(
        `Duplicate stripe event ${eventId} — aborting to avoid false audit`
      );
    }

    console.log(`[inject] Operator public id: ${provision.operatorId}`);
    if (provision.apiKey) {
      console.log(`[inject] API key minted: ${provision.apiKey.slice(0, 8)}…`);
      if (!/^pp_[0-9a-f]{64}$/.test(provision.apiKey)) {
        throw new Error(
          "[ASSERTION B] API key format invalid — expected pp_<64 hex>"
        );
      }
    }

    console.log("[assert] Verifying ASSERTION A (Sybil anchor) + B (credits + key)...");
    const verified = await prisma.$transaction(async (tx) =>
      assertAuditProvisioning(tx, customerId)
    );
    console.log(
      `[assert] PASS — operator=${verified.operatorId}, credits=${verified.credits}, apiKeys=${verified.apiKeyCount}`
    );

    console.log("[teardown] Forensic rollback — purging audit operator...");
    await prisma.$transaction(async (tx) =>
      purgeAuditOperator(tx, customerId, [eventId])
    );

    const ghost = await prisma.operator.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (ghost) {
      throw new Error(
        `[teardown] Audit operator still present after purge: ${customerId}`
      );
    }

    console.log("[teardown] PASS — audit operator purged from production Postgres");
    console.log("\n=== BILLING AUDIT PASSED ===\n");
    process.exit(0);
  } catch (err) {
    console.error("\n=== BILLING AUDIT FAILED ===\n");
    console.error(err instanceof Error ? err.message : err);

    try {
      console.error("[teardown] Attempting emergency purge...");
      await prisma.$transaction(async (tx) =>
        purgeAuditOperator(tx, customerId, [eventId])
      );
      console.error("[teardown] Emergency purge completed");
    } catch (purgeErr) {
      console.error(
        "[teardown] Emergency purge failed:",
        purgeErr instanceof Error ? purgeErr.message : purgeErr
      );
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
