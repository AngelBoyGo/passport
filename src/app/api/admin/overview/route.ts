import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE }
    );
  }
  const operator = session.operator;
  const executiveAdmin = isExecutiveAdmin(operator);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // NON-EXEC (H11): any session user must only see their OWN operator-scoped
  // data — never global enrollment/evidence/engagement counts, recent
  // cross-tenant evidence, or infrastructure config-presence flags. The
  // response still returns the FULL command-center shape (health + activity)
  // so the dashboard renders; only the sensitive global fields are masked.
  if (!executiveAdmin) {
    const [scopedReceipts, scopedReceiptsToday, slashing, recentReceipts] = await Promise.all([
      prisma.receipt.count({ where: { operatorId: operator.id } }),
      prisma.receipt.count({ where: { operatorId: operator.id, issuedAt: { gte: since } } }),
      prisma.slashingLedger.aggregate({ where: { operatorId: operator.id }, _sum: { penaltyCents: true }, _count: true }),
      prisma.receipt.findMany({ where: { operatorId: operator.id }, orderBy: { issuedAt: "desc" }, take: 8, select: { receiptId: true, status: true, receiptType: true, issuedAt: true, agentId: true } }),
    ]);
    const health = await checkHealth(true /* mask config-presence detail */);
    const activity = recentReceipts
      .map((item) => ({ type: "receipt", label: `${item.status} ${item.receiptType} receipt`, detail: item.receiptId, at: item.issuedAt, href: `/verify/${item.receiptId}` }))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        executiveAdmin: false,
        operator: { email: operator.email, tier: operator.tier, credits: operator.credits, accountStatus: operator.accountStatus, stakeBalanceCents: operator.stakeBalanceCents },
        metrics: {
          receipts: scopedReceipts,
          receiptsToday: scopedReceiptsToday,
          issuedAgents: null,
          evidence: null,
          engagements: null,
          slashingEvents: slashing._count,
          slashedCents: slashing._sum.penaltyCents ?? 0,
        },
        health,
        activity,
        copilotContext: { view: "command-center", operatorTier: operator.tier, metrics: { receipts: scopedReceipts, receiptsToday: scopedReceiptsToday, issuedAgents: null, evidence: null, engagements: null }, health },
        publicKey: safePublicKey(),
      },
      { headers: NO_STORE }
    );
  }

  const [receipts, receiptsToday, enrollments, evidence, engagements, slashing, recentReceipts, recentEvidence, recentEngagements] = await Promise.all([
    prisma.receipt.count({ where: { operatorId: operator.id } }),
    prisma.receipt.count({ where: { operatorId: operator.id, issuedAt: { gte: since } } }),
    prisma.agentEnrollment.count({ where: { status: "ISSUED" } }),
    prisma.agentEvidence.count(),
    prisma.engagement.count({ where: { OR: [{ hirerCommitment: { not: "" } }, { workerCommitment: { not: "" } }] } }),
    prisma.slashingLedger.aggregate({ where: { operatorId: operator.id }, _sum: { penaltyCents: true }, _count: true }),
    prisma.receipt.findMany({ where: { operatorId: operator.id }, orderBy: { issuedAt: "desc" }, take: 8, select: { receiptId: true, status: true, receiptType: true, issuedAt: true, agentId: true } }),
    prisma.agentEvidence.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, sourceType: true, normalizedEventType: true, createdAt: true, agentIdentityCommitment: true } }),
    prisma.engagement.findMany({ orderBy: { updatedAt: "desc" }, take: 8, select: { taskId: true, status: true, amount: true, updatedAt: true } }),
  ]);

  const health = await checkHealth();
  const activity = [
    ...recentReceipts.map((item) => ({ type: "receipt", label: `${item.status} ${item.receiptType} receipt`, detail: item.receiptId, at: item.issuedAt, href: `/verify/${item.receiptId}` })),
    ...recentEvidence.map((item) => ({ type: "evidence", label: `${item.sourceType} evidence`, detail: item.normalizedEventType, at: item.createdAt, href: `/profiles/${item.agentIdentityCommitment}` })),
    ...recentEngagements.map((item) => ({ type: "engagement", label: `${item.status.toLowerCase()} engagement`, detail: `${item.taskId} · $${(item.amount / 100).toFixed(2)}`, at: item.updatedAt, href: "/admin" })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      executiveAdmin,
      operator: { email: operator.email, tier: operator.tier, credits: operator.credits, accountStatus: operator.accountStatus, stakeBalanceCents: operator.stakeBalanceCents },
      metrics: { receipts, receiptsToday, issuedAgents: enrollments, evidence, engagements, slashingEvents: slashing._count, slashedCents: slashing._sum.penaltyCents ?? 0 },
      health,
      activity,
      copilotContext: { view: "command-center", operatorTier: operator.tier, metrics: { receipts, receiptsToday, issuedAgents: enrollments, evidence, engagements }, health, recentActivity: activity.slice(0, 5) },
      publicKey: safePublicKey(),
    },
    { headers: NO_STORE }
  );
}

function safePublicKey(): string | null {
  try {
    return getPublicKeyHex();
  } catch {
    return null;
  }
}

async function checkHealth(maskConfig = false) {
  const databaseStarted = Date.now();
  let database: { status: "operational" | "degraded"; latencyMs: number };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { status: "operational", latencyMs: Date.now() - databaseStarted };
  } catch {
    database = { status: "degraded", latencyMs: Date.now() - databaseStarted };
  }
  const signing = Boolean(process.env.SIGNING_PRIVATE_KEY);
  const ingestion = Boolean(process.env.INGESTION_COMMITMENT_SALT);
  // When masking, only expose the DB status; hide config-presence flags which
  // could let a caller infer secrets are/aren't configured.
  const signingOk = maskConfig ? true : signing;
  const ingestionOk = maskConfig ? true : ingestion;
  return {
    overall: database.status === "operational" && signingOk ? "operational" : "degraded",
    components: [
      { id: "database", label: "PostgreSQL", status: database.status, detail: `${database.latencyMs}ms` },
      { id: "signing", label: "Receipt signing", status: signingOk ? "operational" : "degraded", detail: signingOk ? "Ready" : "Not ready" },
      { id: "ingestion", label: "Evidence ingestion", status: ingestionOk ? "operational" : "degraded", detail: ingestionOk ? "Ready" : "Not ready" },
      { id: "api", label: "Public API", status: "operational", detail: "Session and API routes responding" },
    ],
  };
}
