import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { getStripe } from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { ANGL_BATCHES, type AnglBatch } from "@/lib/angelcoin/batch-economy";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/angelcoin/buy — Buy AngelCoin in fixed batches.
 *
 * ANGL is ONLY sold in predefined batch sizes (5 × 3^n pattern) that
 * never divide evenly into feature costs. This guarantees leftover ANGL
 * in every wallet, creating recurring demand and infusing value.
 *
 * Batches: Starter(15) → Small(75) → Medium(375) → Standard(1,875)
 *          → Pro(5,625) → Business(16,875) → Whale(50,625)
 *
 * Rate: 1 ANGL = $0.01 USD. No custom amounts accepted.
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

  let body: { batch_id?: string; agent_commitment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.batch_id) {
    return NextResponse.json({
      error: "batch_id is required. Available batches:",
      batches: ANGL_BATCHES.map((b) => ({ batch_id: b.batch_id, angl: b.angl, usd: `$${(b.usd_cents / 100).toFixed(2)}`, label: b.label })),
    }, { status: 400 });
  }

  const batch: AnglBatch | undefined = ANGL_BATCHES.find((b) => b.batch_id === body.batch_id);
  if (!batch) {
    return NextResponse.json({
      error: `Invalid batch_id: ${body.batch_id}`,
      available: ANGL_BATCHES.map((b) => b.batch_id),
    }, { status: 400 });
  }

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
      batch_id: batch.batch_id,
      label: batch.label,
      angl: batch.angl,
      usd: `$${(batch.usd_cents / 100).toFixed(2)}`,
      target: targetCommitment || "operator_credits",
      url: "/?checkout=mock",
      note: "Dev mode — no Stripe configured. In production, this creates a real Stripe checkout.",
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
            name: `AngelCoin ${batch.label} Batch`,
            description: `${batch.angl.toLocaleString()} ANGL — ${batch.description}`,
          },
          unit_amount: batch.usd_cents,
        },
        quantity: 1,
      },
    ],
    payment_method_types: ["card"],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold"}/dashboard?buy_success=1&batch=${batch.batch_id}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold"}/dashboard?buy_canceled=1`,
    metadata: {
      product: "angelcoin_topup",
      batch_id: batch.batch_id,
      credit_amount: String(batch.angl),
      usd_cents: String(batch.usd_cents),
      target_commitment: targetCommitment || "operator",
    },
  });

  return NextResponse.json({
    batch_id: batch.batch_id,
    label: batch.label,
    angl: batch.angl,
    usd: `$${(batch.usd_cents / 100).toFixed(2)}`,
    target: targetCommitment || "operator_credits",
    url: checkout.url,
    note: "You will receive exactly this amount of ANGL. Batches are fixed — no custom amounts.",
  });
}

/**
 * GET /api/v1/angelcoin/buy — list available batches.
 */
export async function GET() {
  return NextResponse.json({
    batches: ANGL_BATCHES.map((b) => ({
      batch_id: b.batch_id,
      angl: b.angl,
      usd: `$${(b.usd_cents / 100).toFixed(2)}`,
      label: b.label,
      description: b.description,
      recommended_for: getRecommendedFor(b.batch_id),
    })),
    rate: "1 ANGL = $0.01 USD",
    note: "ANGL is only sold in fixed batches. Batch sizes are designed so you always have leftover ANGL for future features.",
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function getRecommendedFor(batchId: string): string {
  switch (batchId) {
    case "starter": return "Trying Passport for the first time";
    case "small": return "Light agent activity — a few hires or credentials";
    case "medium": return "Monthly usage for a single active agent";
    case "standard": return "Pro subscription + regular hiring";
    case "pro": return "Multiple agents, heavy marketplace activity";
    case "business": return "Team of agents across multiple platforms";
    case "whale": return "Enterprise operations, never worry about balance";
    default: return "";
  }
}