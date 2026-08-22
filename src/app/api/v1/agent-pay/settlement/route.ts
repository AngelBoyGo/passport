import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import {
  settleExternalRailPayment,
  type AgentPaymentRail,
} from "@/lib/agent-pay/agent-payment-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

const VALID_RAILS: AgentPaymentRail[] = [
  "passport_credits",
  "stripe_agent",
  "visa_intelligent_commerce",
  "mastercard_agent_pay",
  "x402",
];

/**
 * POST /api/v1/agent-pay/settlement — inbound settlement from an EXTERNAL
 * agentic rail (Stripe agent, Visa Intelligent Commerce, Mastercard Agent Pay,
 * x402). HMAC-authenticated with AGENTIC_PAY_RAIL_SECRET; idempotent on
 * `reference`; credits the agent's Passport wallet.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { ...NO_STORE, ...CORS } });
  }

  if (!process.env.AGENTIC_PAY_RAIL_SECRET) {
    return NextResponse.json(
      { error: "Agentic pay rail is not configured (AGENTIC_PAY_RAIL_SECRET unset)" },
      { status: 501, headers: { ...NO_STORE, ...CORS } }
    );
  }

  let body: {
    rail?: string;
    reference?: string;
    credit_credits?: number;
    signature?: string;
    amount_label?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }

  if (!body.rail || !VALID_RAILS.includes(body.rail as AgentPaymentRail)) {
    return NextResponse.json(
      { error: `Invalid rail. Valid: ${VALID_RAILS.join(", ")}` },
      { status: 400, headers: { ...NO_STORE, ...CORS } }
    );
  }
  if (!body.reference || typeof body.signature !== "string") {
    return NextResponse.json(
      { error: "reference and signature are required" },
      { status: 400, headers: { ...NO_STORE, ...CORS } }
    );
  }

  const creditCredits = Number(body.credit_credits);
  if (!Number.isFinite(creditCredits) || creditCredits <= 0 || !Number.isInteger(creditCredits)) {
    return NextResponse.json(
      { error: "credit_credits must be a positive integer" },
      { status: 400, headers: { ...NO_STORE, ...CORS } }
    );
  }

  const result = await settleExternalRailPayment({
    operatorId: operator.id,
    rail: body.rail as AgentPaymentRail,
    reference: body.reference,
    credit_credits: creditCredits,
    signature: body.signature,
    amount_label: body.amount_label,
  });

  if (!result.accepted) {
    return NextResponse.json(
      { error: result.reason, accepted: false },
      { status: 400, headers: { ...NO_STORE, ...CORS } }
    );
  }

  return NextResponse.json({ accepted: true, credits_added: result.credits_added, new_balance: result.new_balance }, { status: 201, headers: { ...NO_STORE, ...CORS } });
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

// Re-export for tests
export const _settleExternalRailPayment = settleExternalRailPayment;