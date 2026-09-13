import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/raillab/brain/memory — recent Command Brain memory (ISSUER-auth).
 * Query: kind?, limit? (1-200).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:brain:memory:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole === "HOLDER") {
    return NextResponse.json({ error: "Unauthorized: ISSUER key required" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind")?.toUpperCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  const memory = await prisma.brainMemory.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(
    {
      success: true,
      count: memory.length,
      memory: memory.map((m) => ({
        id: m.id,
        cycle_id: m.cycleId,
        kind: m.kind,
        summary: m.summary,
        action: m.action,
        action_result: m.actionResult,
        health_score: m.healthScore,
        at: m.createdAt.toISOString(),
      })),
    },
    { headers: NO_STORE }
  );
}