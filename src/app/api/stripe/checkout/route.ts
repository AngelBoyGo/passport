import { NextRequest, NextResponse } from "next/server";
import {
  createCheckoutSession,
} from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";
import { sessionFromRequest } from "@/lib/auth/cookies";

/**
 * POST /api/stripe/checkout — create Stripe Checkout session.
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required to start a subscription" },
      { status: 401 }
    );
  }

  const operator = await ensureOperator(
    session.operator.stripeCustomerId,
    session.operator.email
  );

  try {
    const session = await createCheckoutSession(
      operator.stripeCustomerId,
      operator.email
    );
    return NextResponse.json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
