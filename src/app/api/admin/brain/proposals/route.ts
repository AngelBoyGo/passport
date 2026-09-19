import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/brain/proposals — list improvement proposals for the executive
 * console (session cookie + ADMIN_OPERATOR_EMAILS allowlist, fail-closed in prod).
 * Query: status?, limit? (1-100).
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Forbidden: executive admin required" }, { status: 403, headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status")?.toUpperCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 25, 1), 100);

  const proposals = await prisma.improvementProposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(
    {
      success: true,
      count: proposals.length,
      proposals: proposals.map((p) => ({
        proposal_id: p.proposalId,
        objective: p.objective,
        expected_improvement: p.expectedImprovement,
        risk_class: p.riskClass,
        status: p.status,
        replay_score: p.replayScore,
        approved_by: p.approvedBy,
        approved_at: p.approvedAt?.toISOString() ?? null,
        created_at: p.createdAt.toISOString(),
      })),
    },
    { headers: NO_STORE }
  );
}