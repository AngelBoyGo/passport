import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { listAgentRevenue } from "@/lib/agent-economy/revenue-bridge";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/** GET /api/v1/agent-revenue/[commitment] — an agent's external revenue entries. Owner or ISSUER. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agent-revenue:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { commitment } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const entries = await listAgentRevenue(commitment);
  const totalUsdCents = entries.reduce((s, e) => s + e.grossUsdCents, 0);
  const totalAngel = entries.reduce((s, e) => s + e.angelCredited, 0);

  return NextResponse.json(
    {
      success: true,
      agent_commitment: commitment,
      count: entries.length,
      total_gross_usd_cents: totalUsdCents,
      total_angel_credited: totalAngel,
      entries: entries.map((e) => ({
        external_ref: e.externalRef,
        source: e.source,
        gross_usd_cents: e.grossUsdCents,
        angel_credited: e.angelCredited,
        status: e.status,
        at: e.createdAt.toISOString(),
      })),
    },
    { headers: NO_STORE }
  );
}
