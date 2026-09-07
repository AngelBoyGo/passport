import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getAggregatedDividends } from "@/lib/reserves/royalty-waterfall";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/dividends — Sovereign Dividend Waterfall & Anti-Extraction Telemetry.
 *
 * Returns macroeconomic metrics on commodity clearing fee distributions:
 * - National Sovereign Dividend (infrastructure, education, health)
 * - Local Mining Community Trust (municipalities & chieftaincies)
 * - Mine Workers' Production Bonus (unionized & cooperative miners)
 * - AES Sovereign Stabilization Fund (counter-cyclical reserves)
 * - Validator Sentry Pool & Executing Agent Computational Rebates
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:dividends:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10), 100) : 10;

  try {
    const data = await getAggregatedDividends(limit);

    return NextResponse.json(
      {
        success: true,
        totals: {
          total_fees_captured_angel: data.totals.totalFeesCapturedAngel,
          national_treasury_angel: data.totals.nationalTreasuryAngel,
          community_trust_angel: data.totals.communityTrustAngel,
          workers_bonus_angel: data.totals.workersBonusAngel,
          treasury_stabilization_angel: data.totals.treasuryStabilizationAngel,
          validator_pool_angel: data.totals.validatorPoolAngel,
          agent_rebates_angel: data.totals.agentRebatesAngel,
          total_disbursement_events: data.totals.count,
        },
        statutory_formula: {
          standard: "AES Protocol ASMC-3 (Black Paper Q141)",
          state_tier_percent: "40% (National 50%, Community 30%, Workers 20%)",
          treasury_stabilization_percent: "30%",
          validators_pool_percent: "20%",
          agent_rebate_percent: "10%",
        },
        recent_disbursements: data.recentDisbursements,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
