/**
 * Seeds domain-tagged receipts and verifies POST /api/v1/gate/verify responses.
 * Run after inject-mock-stripe-event.ts in container verification.
 */
import {
  ErrorTranche,
  OperationalDomain,
  PrismaClient,
} from "@prisma/client";

const APP_URL = process.env.VERIFY_APP_URL ?? "http://localhost:3000";
const CUSTOMER_ID = "cus_verify_container_test";
const PUBLIC_OPERATOR_ID = `op_${CUSTOMER_ID}`;
const AGENT_ID = "agent_gate_verify";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://passport:passport@localhost:5433/passport?schema=public";

function receiptBase(
  operatorId: string,
  agentRecordId: string,
  suffix: string
) {
  const now = new Date();
  return {
    receiptId: `rcpt_gate_${suffix}`,
    operatorId,
    agentId: AGENT_ID,
    agentRecordId,
    receiptType: "competence",
    status: "success",
    inputDigest: `digest_${suffix}`,
    authorityScope: "gate-verify",
    expiry: new Date(now.getTime() + 86_400_000),
    contentHash: `hash_${suffix}`,
    finalizedAt: now,
  };
}

async function seedReceipts(
  prisma: PrismaClient,
  operatorId: string,
  agentRecordId: string,
  domain: OperationalDomain,
  total: number,
  errorCount: number
) {
  for (let i = 0; i < total; i++) {
    const suffix = `${domain.toLowerCase()}_${i}`;
    await prisma.receipt.create({
      data: {
        ...receiptBase(operatorId, agentRecordId, suffix),
        domain,
        errorTranche:
          i < errorCount ? ErrorTranche.DATA_LEAKAGE : ErrorTranche.NONE,
        issuedAt: new Date(Date.now() - i * 1000),
      },
    });
  }
}

async function postGateVerify(
  operatorId: string,
  domain: OperationalDomain
): Promise<{ allow_invocation: boolean; reason?: string }> {
  const res = await fetch(`${APP_URL}/api/v1/gate/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: operatorId, domain }),
  });
  if (!res.ok) {
    throw new Error(`Gate verify HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const operator = await prisma.operator.findUnique({
      where: { stripeCustomerId: CUSTOMER_ID },
    });
    if (!operator) {
      throw new Error(
        `Operator not found for ${CUSTOMER_ID} — run inject-mock-stripe-event first`
      );
    }

    await prisma.operator.update({
      where: { id: operator.id },
      data: { stakeBalanceCents: 50_000 },
    });

    const agent = await prisma.agent.upsert({
      where: {
        operatorId_agentId: { operatorId: operator.id, agentId: AGENT_ID },
      },
      create: {
        operatorId: operator.id,
        agentId: AGENT_ID,
        domain: "gate-verify",
      },
      update: {},
    });

    await prisma.receipt.deleteMany({
      where: {
        operatorId: operator.id,
        domain: {
          in: [
            OperationalDomain.FINANCIAL_CLEARING,
            OperationalDomain.CODE_GENERATION,
          ],
        },
      },
    });

    console.log("[gate-seed] Seeding FINANCIAL_CLEARING (2/20 errors, <=10%)...");
    await seedReceipts(
      prisma,
      operator.id,
      agent.id,
      OperationalDomain.FINANCIAL_CLEARING,
      20,
      2
    );

    console.log("[gate-seed] Seeding CODE_GENERATION (3/20 errors, >10%)...");
    await seedReceipts(
      prisma,
      operator.id,
      agent.id,
      OperationalDomain.CODE_GENERATION,
      20,
      3
    );

    console.log("[gate-seed] POST gate/verify FINANCIAL_CLEARING...");
    const clean = await postGateVerify(
      PUBLIC_OPERATOR_ID,
      OperationalDomain.FINANCIAL_CLEARING
    );
    console.log("[gate-seed] FINANCIAL_CLEARING response:", clean);
    if (!clean.allow_invocation) {
      throw new Error(
        `Expected FINANCIAL_CLEARING allow:true, got ${JSON.stringify(clean)}`
      );
    }

    console.log("[gate-seed] POST gate/verify CODE_GENERATION...");
    const breaching = await postGateVerify(
      PUBLIC_OPERATOR_ID,
      OperationalDomain.CODE_GENERATION
    );
    console.log("[gate-seed] CODE_GENERATION response:", breaching);
    if (breaching.allow_invocation) {
      throw new Error(
        `Expected CODE_GENERATION allow:false, got ${JSON.stringify(breaching)}`
      );
    }
    if (breaching.reason !== "SLA_BREACH_THRESHOLD_EXCEEDED") {
      throw new Error(
        `Expected SLA_BREACH_THRESHOLD_EXCEEDED, got ${breaching.reason}`
      );
    }

    console.log("[gate-seed] POST gate/verify SYSTEM_INTEGRATION (unseeded)...");
    const blank = await postGateVerify(
      PUBLIC_OPERATOR_ID,
      OperationalDomain.SYSTEM_INTEGRATION
    );
    console.log("[gate-seed] SYSTEM_INTEGRATION response:", blank);
    if (blank.allow_invocation) {
      throw new Error(
        `Expected SYSTEM_INTEGRATION allow:false, got ${JSON.stringify(blank)}`
      );
    }
    if (blank.reason !== "ZERO_TENANCY_REJECT") {
      throw new Error(
        `Expected ZERO_TENANCY_REJECT, got ${blank.reason}`
      );
    }

    console.log(
      "[gate-seed] PASS — allow/deny/zero-tenancy assertions confirmed"
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[gate-seed] FAIL:", err);
  process.exit(1);
});
