import { NextResponse } from "next/server";
import { mockDevCheckout } from "@/lib/stripe";

/**
 * POST /api/dev/provision — dev-only operator + API key (no Stripe).
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const result = await mockDevCheckout();
  return NextResponse.json(result);
}
