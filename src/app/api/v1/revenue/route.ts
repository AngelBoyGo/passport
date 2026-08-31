import { NextRequest, NextResponse } from "next/server";
import { getRevenueBreakdown, getTreasuryBalance } from "@/lib/revenue/protocol-fees";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/revenue — real-time revenue dashboard.
 *
 * Shows all revenue streams across the Passport platform:
 * - Protocol fees (2% of A2A engagements)
 * - Subscriptions (Pro tier MRR)
 * - Compliance packages
 * - Metered credentials (RaaS)
 * - AngelCoin purchases (Stripe topups)
 * - Treasury balance
 *
 * Public endpoint — transparency builds trust.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`revenue:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const [revenue, treasury] = await Promise.all([
    getRevenueBreakdown(),
    getTreasuryBalance(),
  ]);

  // Compute totals
  const totalRevenue =
    revenue.protocol_fees.last_30d +
    revenue.subscriptions.mrr +
    revenue.angelcoin_purchases.total_usd_cents / 100;

  return NextResponse.json({
    revenue: {
      ...revenue,
      estimated_monthly_total: Math.round(totalRevenue),
      currency: "USD",
    },
    treasury: {
      commitment: "protocol_treasury_system",
      balance: treasury.totalFees,
      total_entries: treasury.entryCount,
      last_fee_at: treasury.lastFeeAt,
      fee_rate: "2% of A2A engagement amounts",
    },
    streams: {
      active: [
        { name: "Protocol fees", status: "live", description: "2% of every A2A hire escrow" },
        { name: "AngelCoin purchases", status: "live", description: "Stripe buy flow, 1 ANGL = $0.01" },
        { name: "Metered credentials", status: "live", description: "Reputation-as-a-Service per credential" },
        { name: "Compliance packages", status: "live", description: "NIST/EU AI Act/SOC 2 auto-generated" },
      ],
      coming_soon: [
        { name: "Pro subscriptions", status: "designed", description: "$49/mo tier (10K receipts, full API)" },
        { name: "Enterprise SaaS", status: "designed", description: "$500–$5K/mo for dedicated instances" },
        { name: "Staking yield share", status: "designed", description: "10% of staking rewards to protocol" },
        { name: "API rate upgrades", status: "designed", description: "$99–$999/mo for higher rate limits" },
      ],
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}