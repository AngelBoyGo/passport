import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { createUsdcTopupCheckout } from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/v1/account/topup — create a Stripe Checkout session that accepts
 * USDC to credit the operator's account. On completion, the Stripe webhook
 * (checkout.session.completed, product=credits_topup) credits Operator.credits
 * and writes an OperatorLedgerEntry.
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { ...NO_STORE, ...CORS } });
  }

  const usdCents = Number((await request.json().catch(() => ({}))).usd_cents ?? 0);
  if (!Number.isFinite(usdCents) || usdCents < 50) {
    return NextResponse.json({ error: "usd_cents must be at least 50" }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }

  const operator = await ensureOperator(session.operator.stripeCustomerId, session.operator.email);

  const checkout = await createUsdcTopupCheckout(operator.stripeCustomerId, usdCents);
  return NextResponse.json(checkout, { headers: { ...NO_STORE, ...CORS } });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}