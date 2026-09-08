import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { handleUssdInteraction } from "@/lib/digital-gateway/ussd";
import { settleMobileMoneyOnramp } from "@/lib/digital-gateway/mobile-money";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/digital/ussd/session
 * USSD gateway interaction (feature-phone `*123#` menu). The BUY confirm path
 * reuses the mobile-money settlement core with a direct (non-provider) settlement.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`digital:ussd:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = String(body.session_id || body.sessionId || "");
  const phoneNumber = String(body.phone_number || body.phoneNumber || "");
  const input = String(body.input || "");

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const response = await handleUssdInteraction(
      {
        sessionId,
        phoneNumber,
        input,
      },
      {
        onBuyConfirm: async (xofAmount: number) => {
          // Direct on-ramp: no provider callback; tracked as provider "ussd".
          const txnId = `${sessionId}-${Date.now()}`;
          const result = await settleMobileMoneyOnramp({
            provider: "ussd",
            payload: {
              external_reference: txnId,
              amount: xofAmount,
            },
            internal: true,
          });
          return {
            creditedAngel: result.creditedAngel,
            reference: result.settlementId,
          };
        },
      }
    );

    return NextResponse.json(
      { success: true, reply: response.reply, done: response.done },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}