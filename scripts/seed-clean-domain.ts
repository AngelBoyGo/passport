/**
 * Seeds clean finalized receipts for blank-sheet gate bootstrap.
 * Run: npx tsx scripts/seed-clean-domain.ts
 *
 * Requires PASSPORT_OPERATOR_DB_ID, DATABASE_URL.
 * Optional: SEED_DOMAIN (default CODE_GENERATION), SEED_RECEIPT_COUNT (default 5).
 */
import { ErrorTranche, OperationalDomain, PrismaClient } from "@prisma/client";

const SEED_AGENT_ID = "framework-seed-agent";
const DEFAULT_DOMAIN = "CODE_GENERATION" as const;
const DEFAULT_RECEIPT_COUNT = 5;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const operatorDbId = requireEnv("PASSPORT_OPERATOR_DB_ID");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://passport:passport@localhost:5433/passport?schema=public";
  const domainName = (process.env.SEED_DOMAIN ?? DEFAULT_DOMAIN) as keyof typeof OperationalDomain;
  const receiptCount = Number(process.env.SEED_RECEIPT_COUNT ?? DEFAULT_RECEIPT_COUNT);
  const domain = OperationalDomain[domainName];

  if (!domain) {
    throw new Error(`Invalid SEED_DOMAIN: ${domainName}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const agent = await prisma.agent.upsert({
      where: {
        operatorId_agentId: { operatorId: operatorDbId, agentId: SEED_AGENT_ID },
      },
      create: {
        operatorId: operatorDbId,
        agentId: SEED_AGENT_ID,
        domain: "framework-seed",
      },
      update: {},
    });

    await prisma.receipt.deleteMany({
      where: { operatorId: operatorDbId, domain },
    });

    for (let i = 0; i < receiptCount; i++) {
      const suffix = `clean_${i}`;
      const now = new Date(Date.now() - i * 1000);
      await prisma.receipt.create({
        data: {
          receiptId: `rcpt_framework_${suffix}`,
          operatorId: operatorDbId,
          agentId: SEED_AGENT_ID,
          agentRecordId: agent.id,
          receiptType: "competence",
          status: "success",
          inputDigest: `digest_${suffix}`,
          authorityScope: "framework.seed",
          expiry: new Date(now.getTime() + 86_400_000),
          contentHash: `hash_${suffix}`,
          finalizedAt: now,
          issuedAt: now,
          domain,
          errorTranche: ErrorTranche.NONE,
        },
      });
    }

    console.log(
      `[seed-clean-domain] Seeded ${receiptCount} clean ${domainName} receipts for ${operatorDbId}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed-clean-domain] FAILED:", err);
  process.exit(1);
});
