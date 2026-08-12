import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromToken } from "@/lib/auth/auth-service";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export const dynamic = "force-dynamic";

async function getOperator(request: NextRequest) {
  const token = request.cookies.get("session_token")?.value;
  if (!token) return null;
  const session = await getSessionFromToken(token);
  return session?.operator ?? null;
}

export async function GET(request: NextRequest) {
  const operator = await getOperator(request);
  if (!operator) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isExecutiveAdmin(operator)) return NextResponse.json({ error: "Executive admin access required" }, { status: 403 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
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

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    operator: { email: operator.email, tier: operator.tier, credits: operator.credits, accountStatus: operator.accountStatus, stakeBalanceCents: operator.stakeBalanceCents },
    metrics: { receipts, receiptsToday, issuedAgents: enrollments, evidence, engagements, slashingEvents: slashing._count, slashedCents: slashing._sum.penaltyCents ?? 0 },
    health,
    activity,
    copilotContext: { view: "command-center", operatorTier: operator.tier, metrics: { receipts, receiptsToday, issuedAgents: enrollments, evidence, engagements }, health, recentActivity: activity.slice(0, 5) },
    publicKey: getPublicKeyHex(),
  });
}

async function checkHealth() {
  const databaseStarted = Date.now();
  let database: { status: "operational" | "degraded"; latencyMs: number };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { status: "operational", latencyMs: Date.now() - databaseStarted };
  } catch {
    database = { status: "degraded", latencyMs: Date.now() - databaseStarted };
  }
  return {
    overall: database.status === "operational" && Boolean(process.env.SIGNING_PRIVATE_KEY) ? "operational" : "degraded",
    components: [
      { id: "database", label: "PostgreSQL", status: database.status, detail: `${database.latencyMs}ms` },
      { id: "signing", label: "Receipt signing", status: process.env.SIGNING_PRIVATE_KEY ? "operational" : "degraded", detail: process.env.SIGNING_PRIVATE_KEY ? "Ed25519 key loaded" : "SIGNING_PRIVATE_KEY missing" },
      { id: "ingestion", label: "Evidence ingestion", status: process.env.INGESTION_COMMITMENT_SALT ? "operational" : "degraded", detail: process.env.INGESTION_COMMITMENT_SALT ? "Commitment salt loaded" : "INGESTION_COMMITMENT_SALT missing" },
      { id: "api", label: "Public API", status: "operational", detail: "Session and API routes responding" },
    ],
  };
}
