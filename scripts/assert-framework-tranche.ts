/**
 * Asserts persisted errorTranche for a receipt from python_e2e_result.json.
 * Run: npx tsx scripts/assert-framework-tranche.ts
 *
 * Requires DATABASE_URL; reads receiptId from passport/python/python_e2e_result.json.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RESULT_PATH = path.join(ROOT, "python", "python_e2e_result.json");
const EXPECTED_TRANCHE = "COMPUTE_TIMEOUT";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://passport:passport@localhost:5433/passport?schema=public";

  const payload = JSON.parse(readFileSync(RESULT_PATH, "utf8")) as {
    receiptId: string;
  };

  if (!payload.receiptId) {
    throw new Error(`Missing receiptId in ${RESULT_PATH}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const row = await prisma.receipt.findUnique({
      where: { receiptId: payload.receiptId },
    });

    if (!row) {
      throw new Error(`Receipt ${payload.receiptId} not found in database`);
    }

    console.log("[assert-framework-tranche] Persisted row:", {
      receiptId: row.receiptId,
      errorTranche: row.errorTranche,
      status: row.status,
    });

    if (row.errorTranche !== EXPECTED_TRANCHE) {
      throw new Error(
        `Expected errorTranche ${EXPECTED_TRANCHE}, got ${row.errorTranche}`
      );
    }

    console.log("[assert-framework-tranche] Tranche assertion passed");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[assert-framework-tranche] FAILED:", err);
  process.exit(1);
});
