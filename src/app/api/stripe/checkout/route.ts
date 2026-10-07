import { NextRequest, NextResponse } from "next/server";
import {
  createCheckoutSession,
  resolveStripeCustomerId,
} from "@/lib/stripe";
import { ensureOperator } from "@/lib/operator";
import { prisma } from "@/lib/db";
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
    // Repair a stale/fake Stripe customer id before checkout.
    const customerId = await resolveStripeCustomerId(operator.stripeCustomerId, operator.email);
    if (customerId !== operator.stripeCustomerId) {
      await prisma.operator.update({
        where: { id: operator.id },
        data: { stripeCustomerId: customerId },
      });
    }
    const checkout = await createCheckoutSession(customerId, operator.email);
    return NextResponse.json(checkout);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
