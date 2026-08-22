import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import {
  authorizeAgentSpend,
  createSpendScope,
} from "@/lib/agent-pay/agent-payment-service";
import { ATTESTATION_CATALOG, type AttestationProduct } from "@/lib/metering/attestation-meter";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/v1/agent-pay/spend — an agent authorizes a scoped payment from its
 * Passport wallet against an attestation product. Mirrors 2026 agentic-payment
 * patterns (spend scope with ceiling + merchant bind, agent Ed25519 signature).
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { ...NO_STORE, ...CORS } });
  }

  let body: {
    product?: string;
    max_credits?: number;
    agent_signature?: string;
    agent_public_key?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }

  const product = body.product as AttestationProduct | undefined;
  if (!product || !ATTESTATION_CATALOG[product]) {
    return NextResponse.json(
      { error: `Invalid product. Valid: ${Object.keys(ATTESTATION_CATALOG).join(", ")}` },
      { status: 400, headers: { ...NO_STORE, ...CORS } }
    );
  }

  const maxCredits = body.max_credits ?? 1;
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
    return NextResponse.json({ error: "max_credits must be a positive number" }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }

  const scope = createSpendScope(product, maxCredits);
  const result = await authorizeAgentSpend({
    operatorId: operator.id,
    product,
    scope,
    agentSignatureHex: body.agent_signature,
    agentPublicKeyHex: body.agent_public_key,
  });

  if (!result.authorized) {
    return NextResponse.json(
      { error: result.reason, authorized: false },
      { status: 402, headers: { ...NO_STORE, ...CORS } }
    );
  }

  return NextResponse.json(
    {
      authorized: true,
      product: result.product,
      credits_charged: result.credits_charged,
      remaining_credits: result.remaining_credits,
      meter_ref: result.meter_ref,
      payment_digest: result.payment_digest,
    },
    { status: 201, headers: { ...NO_STORE, ...CORS } }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}