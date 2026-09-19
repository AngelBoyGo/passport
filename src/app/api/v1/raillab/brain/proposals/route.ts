import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import { createProposal } from "@/lib/brain/proposal-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/raillab/brain/proposals — list improvement proposals (ISSUER-auth).
 * Query: status?, limit? (1-100).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:brain:proposals:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401, headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status")?.toUpperCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100);

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
        source_scan_id: p.sourceScanId,
        params: p.params,
        replay_id: p.replayId,
        replay_score: p.replayScore,
        approved_by: p.approvedBy,
        approved_at: p.approvedAt?.toISOString() ?? null,
        created_at: p.createdAt.toISOString(),
      })),
    },
    { headers: NO_STORE }
  );
}

/**
 * POST /api/v1/raillab/brain/proposals — create a proposal (ISSUER-auth).
 * Body: { objective, expected_improvement, risk?, params? }
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:brain:proposals:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 20));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const riskRaw = String(body.risk ?? body.risk_class ?? "low").toLowerCase();
  const risk = riskRaw === "medium" || riskRaw === "high" ? riskRaw : "low";

  try {
    const result = await createProposal({
      objective: String(body.objective ?? ""),
      expectedImprovement: String(body.expected_improvement ?? body.expectedImprovement ?? ""),
      riskClass: risk,
      params: body.params,
    });
    return NextResponse.json(
      { success: true, proposal_id: result.proposalId, deduped: result.deduped },
      { status: result.deduped ? 200 : 201, headers: NO_STORE }
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "invalid_proposal") {
      return NextResponse.json({ error: (err as Error).message }, { status: 400, headers: NO_STORE });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500, headers: NO_STORE });
  }
}