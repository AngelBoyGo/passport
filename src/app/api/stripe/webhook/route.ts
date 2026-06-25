import { NextRequest, NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/stripe";

/**
 * POST /api/stripe/webhook — Stripe billing events.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const result = await handleStripeWebhook(body, signature);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
