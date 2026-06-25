import { NextRequest, NextResponse } from "next/server";
import {
  createCheckoutSession,
  getOrCreateStripeCustomer,
} from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";

/**
 * POST /api/stripe/checkout — create Stripe Checkout session.
 */
export async function POST(request: NextRequest) {
  let body: { stripe_customer_id?: string; email?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* optional body */
  }

  const stripeCustomerId =
    body.stripe_customer_id ??
    (await getOrCreateStripeCustomer(body.email));
  const operator = await ensureOperator(stripeCustomerId, body.email);

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
