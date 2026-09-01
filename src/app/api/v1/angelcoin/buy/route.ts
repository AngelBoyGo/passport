import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { getStripe } from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { ANGEL_BUNDLES, MONETARY_PARAMS } from "@/lib/angelcoin/monetary";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/angelcoin/buy — Buy ANGEL in fixed bundles.
 *
 * ANGEL is only sold in 4 bundle sizes (2^k + 1 geometry) that guarantee
 * exactly 1 stranded ANGEL against any feature in the {2, 4, 8, 16, 32} grid.
 *
 * Bundles: Starter(5) → Standard(9) → Pro(17) → Studio(33)
 * Rate: 1 ANGEL = $5.00 USD (Monetary Spec v1.1)
 * Prices: $25 / $45 / $85 / $165
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`angelcoin-buy:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } });
  }

  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { bundle_id?: string; agent_commitment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.bundle_id) {
    return NextResponse.json({
      error: "bundle_id is required",
      bundles: ANGEL_BUNDLES.map((b) => ({
        bundle_id: b.bundle_id,
        angl: b.angl,
        usd: `$${b.angl * MONETARY_PARAMS.P0}`,
        label: b.label,
      })),
    }, { status: 400 });
  }

  const bundle = ANGEL_BUNDLES.find((b) => b.bundle_id === body.bundle_id);
  if (!bundle) {
    return NextResponse.json({
      error: `Invalid bundle_id: ${body.bundle_id}`,
      available: ANGEL_BUNDLES.map((b) => b.bundle_id),
    }, { status: 400 });
  }

  const priceUsdCents = Math.round(bundle.angl * MONETARY_PARAMS.P0 * 100);
  const targetCommitment = body.agent_commitment?.toLowerCase() || null;
  if (targetCommitment && !/^[0-9a-f]{64}$/i.test(targetCommitment)) {
    return NextResponse.json({ error: "Invalid agent commitment hash" }, { status: 400 });
  }

  if (targetCommitment) {
    const agent = await prisma.agent.findFirst({
      where: { operatorId: session.operator.id, agentId: targetCommitment },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not owned by you" }, { status: 403 });
    }
  }

  const operator = await ensureOperator(session.operator.stripeCustomerId, session.operator.email);
  const stripe = getStripe();

  if (!stripe) {
    return NextResponse.json({
      mock: true,
      bundle_id: bundle.bundle_id,
      label: bundle.label,
      angl: bundle.angl,
      usd: `$${(priceUsdCents / 100).toFixed(2)}`,
      rate: `$${MONETARY_PARAMS.P0.toFixed(2)} per ANGEL`,
      target: targetCommitment || "operator_credits",
      url: "/?checkout=mock",
    });
  }

  const checkout = await stripe.checkout.sessions.create({
    customer: operator.stripeCustomerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `ANGEL ${bundle.label} Bundle`,
            description: `${bundle.angl} ANGEL — ${bundle.description} Rate: $${MONETARY_PARAMS.P0.toFixed(2)}/ANGEL`,
          },
          unit_amount: priceUsdCents,
        },
        quantity: 1,
      },
    ],
    payment_method_types: ["card"],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold"}/dashboard?buy_success=1&bundle=${bundle.bundle_id}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold"}/dashboard?buy_canceled=1`,
    metadata: {
      product: "angelcoin_topup",
      bundle_id: bundle.bundle_id,
      credit_amount: String(bundle.angl),
      usd_cents: String(priceUsdCents),
      rate_at_purchase: String(MONETARY_PARAMS.P0),
      target_commitment: targetCommitment || "operator",
    },
  });

  return NextResponse.json({
    bundle_id: bundle.bundle_id,
    label: bundle.label,
    angl: bundle.angl,
    usd: `$${(priceUsdCents / 100).toFixed(2)}`,
    rate: `$${MONETARY_PARAMS.P0.toFixed(2)} per ANGEL`,
    stranded_after_max_spend: 1,
    target: targetCommitment || "operator_credits",
    url: checkout.url,
  });
}

/**
 * GET /api/v1/angelcoin/buy — list available bundles.
 */
export async function GET() {
  return NextResponse.json({
    bundles: ANGEL_BUNDLES.map((b) => ({
      bundle_id: b.bundle_id,
      angl: b.angl,
      usd: `$${b.angl * MONETARY_PARAMS.P0}`,
      label: b.label,
      description: b.description,
      stranded_after_max_spend: 1,
      covers_features: FEATURE_COVERAGE[b.bundle_id] || [],
    })),
    rate: `$${MONETARY_PARAMS.P0.toFixed(2)} per ANGEL`,
    geometry: "Bundles are 2^k + 1. Features are powers of 2. B mod F = 1 for every combination. Exactly 1 stranded ANGEL guaranteed.",
    note: "ANGEL is only sold in fixed bundles. The 2^k+1 geometry guarantees leftover value.",
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const FEATURE_COVERAGE: Record<string, string[]> = {
  starter: ["2 ANGEL features", "4 ANGEL features"],
  standard: ["2 ANGEL features", "4 ANGEL features", "8 ANGEL features"],
  pro: ["2, 4, 8, 16 ANGEL features"],
  studio: ["All features up to 32 ANGEL"],
};