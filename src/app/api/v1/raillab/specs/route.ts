import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/specs — list rail specs, filter by state / category.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:specs:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  const category = searchParams.get("category");

  const where: Record<string, unknown> = {};
  if (state) where.state = state.toUpperCase();
  if (category) where.category = category.toUpperCase();

  const specs = await prisma.railSpec.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    {
      success: true,
      specs: specs.map((s) => ({
        id: s.id,
        rail_key: s.railKey,
        name: s.name,
        category: s.category,
        provider_key: s.providerKey,
        ledger_kind: s.ledgerKind,
        kyc_tier: s.kycTier,
        fee_bps: s.feeBps,
        state: s.state,
        blueprint_id: s.blueprintId,
        author_commitment: s.authorCommitment,
        authorized_by: s.authorizedBy,
        version: s.version,
        created_at: s.createdAt.toISOString(),
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}