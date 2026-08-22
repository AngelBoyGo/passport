import { NextResponse } from "next/server";
import { mockDevCheckout } from "@/lib/stripe";

/**
 * POST /api/dev/provision — dev-only operator + API key (no Stripe).
 * Hard-gated: production always disabled; even in non-prod it requires an
 * explicit ALLOW_DEV_PROVISION="1" opt-in so a test/staging deploy can never
 * accidentally expose a key-minting backdoor.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  if (process.env.ALLOW_DEV_PROVISION !== "1") {
    return NextResponse.json(
      { error: "Dev provisioning is not enabled (set ALLOW_DEV_PROVISION=1 in non-production only)" },
      { status: 404 }
    );
  }
  const result = await mockDevCheckout();
  return NextResponse.json(result);
}
