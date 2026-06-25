/**
 * End-to-end smoke test: provision → issue → finalize → verify.
 * Run: npx tsx scripts/smoke-test.ts
 */
import { configureEd25519 } from "../src/lib/receipt/crypto";
configureEd25519();

process.env.SIGNING_PRIVATE_KEY =
  process.env.SIGNING_PRIVATE_KEY ??
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const { mockDevCheckout } = await import("../src/lib/stripe");
  const { issueReceipt, finalizeReceipt, dbReceiptToPayload } = await import(
    "../src/lib/receipt-service"
  );
  const { verifyReceipt } = await import("../src/lib/receipt/verify");
  const { sha256Hex } = await import("../src/lib/receipt/canonical");
  const { operatorIdFromStripe } = await import("../src/lib/operator");

  console.log("=== Passport smoke test ===\n");

  const { operatorDbId, apiKey, operatorId } = await mockDevCheckout();
  console.log("1. Provisioned operator:", operatorId);
  console.log("   API key:", apiKey.slice(0, 16) + "…");

  const operator = await prisma.operator.findUnique({
    where: { id: operatorDbId },
  });
  if (!operator) throw new Error("Operator missing");

  const { signed: pending } = await issueReceipt(operatorDbId, {
    operator_id: operatorId,
    agent_id: "smoke-agent",
    receipt_type: "competence",
    input_digest: sha256Hex("smoke test input"),
    authority_scope: "smoke.test",
    expiry: new Date(Date.now() + 86400000).toISOString(),
  });
  console.log("2. Issued receipt:", pending.receipt_id);

  const { signed: finalized } = await finalizeReceipt(
    operatorDbId,
    pending.receipt_id,
    {
      status: "success",
      output_hash: sha256Hex("smoke test output"),
    }
  );
  console.log("3. Finalized status:", finalized.status);

  const row = await prisma.receipt.findUnique({
    where: { receiptId: finalized.receipt_id },
    include: { operator: true },
  });
  if (!row) throw new Error("Receipt missing");

  const payload = dbReceiptToPayload({
    ...row,
    operatorId: operatorIdFromStripe(row.operator.stripeCustomerId),
  });
  const result = await verifyReceipt(payload);
  console.log("4. Verify result:", result.valid ? "VALID" : result.error);

  await prisma.$disconnect();
  console.log("\n=== Smoke test complete ===");
  process.exit(result.valid ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
