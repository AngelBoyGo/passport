import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { getStripe } from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/angelcoin/buy — Buy AngelCoin credits with USD.
 *
 * Creates a Stripe Checkout session that accepts USDC.
 * On completion, credits are deposited into the agent's wallet.
 *
 * Rate: 1 AngelCoin = $0.01 USD (100 AngelCoin = $1)
 * Min: $1.00 (100 AngelCoin)
 * Max: $5,000 (500,000 AngelCoin)
 *
 * The credits go directly to the agent's liberated wallet, not the operator.
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

  let body: { usd_cents?: number; agent_commitment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const usdCents = body.usd_cents ?? 0;
  if (!Number.isFinite(usdCents) || usdCents < 100 || usdCents > 500000) {
    return NextResponse.json({ error: "Amount must be between $1.00 and $5,000.00" }, { status: 400 });
  }

  // Determine target — agent wallet or operator credits
  const targetCommitment = body.agent_commitment?.toLowerCase() || null;
  if (targetCommitment && !/^[0-9a-f]{64}$/i.test(targetCommitment)) {
    return NextResponse.json({ error: "Invalid agent commitment hash" }, { status: 400 });
  }

  // Verify agent ownership if specified
  if (targetCommitment) {
    const agent = await prisma.agent.findFirst({
      where: { operatorId: session.operator.id, agentId: targetCommitment },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not owned by you" }, { status: 403 });
    }
  }

  const creditAmount = Math.floor((usdCents * 100) / 100); // 1 cent = 1 AngelCoin
  const operator = await ensureOperator(session.operator.stripeCustomerId, session.operator.email);
  const stripe = getStripe();

  if (!stripe) {
    // Dev/mock path
    return NextResponse.json({
      mock: true,
      rate: "1 AngelCoin = $0.01",
      usd_cents: usdCents,
      angelcoin: creditAmount,
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
            name: `AngelCoin credit top-up`,
            description: targetCommitment
              ? `${creditAmount} AngelCoin → agent wallet ${targetCommitment.slice(0, 12)}…`
              : `${creditAmount} AngelCoin → operator credits`,
          },
          unit_amount: usdCents,
        },
        quantity: 1,
      },
    ],
    payment_method_types: ["card"],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold"}/dashboard?buy_success=1`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold"}/dashboard?buy_canceled=1`,
    metadata: {
      product: "angelcoin_topup",
      usd_cents: String(usdCents),
      credit_amount: String(creditAmount),
      target_commitment: targetCommitment || "operator",
    },
  });

  return NextResponse.json({
    mock: false,
    rate: "1 AngelCoin = $0.01",
    usd_cents: usdCents,
    angelcoin: creditAmount,
    target: targetCommitment || "operator_credits",
    url: checkout.url,
  });
}