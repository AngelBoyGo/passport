/**
 * Idempotently seeds the PUBLIC_EVIDENCE_MINTER Operator row.
 * Run: npm run seed:evidence-minter
 *
 * Prints the Operator.id to set as EVIDENCE_BRIDGE_OPERATOR_ID.
 */
import { PrismaClient } from "@prisma/client";
import {
  buildEvidenceMinterUpsert,
  formatSeedMinterHelp,
  parseSeedMinterArgs,
  requireDatabaseUrl,
} from "../src/lib/release/seed-minter-args";

async function main(): Promise<void> {
  const args = parseSeedMinterArgs(process.argv.slice(2));

  if (args.showHelp) {
    console.log(formatSeedMinterHelp());
    return;
  }

  const databaseUrl = args.databaseUrl || requireDatabaseUrl();
  const upsert = buildEvidenceMinterUpsert(args.stripeCustomerId);

  if (args.dryRun) {
    console.log("[seed-evidence-minter] dry-run — would upsert Operator:");
    console.log(JSON.stringify(upsert, null, 2));
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const operator = await prisma.operator.upsert(upsert);

    console.log("[seed-evidence-minter] PUBLIC_EVIDENCE_MINTER ready");
    console.log(`  Operator.id: ${operator.id}`);
    console.log(`  stripeCustomerId: ${operator.stripeCustomerId}`);
    console.log("");
    console.log("Set in your environment:");
    console.log(`  EVIDENCE_BRIDGE_OPERATOR_ID=${operator.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed-evidence-minter] FAILED:", err);
  process.exit(1);
});
