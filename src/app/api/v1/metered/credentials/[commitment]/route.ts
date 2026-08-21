import { NextRequest, NextResponse } from "next/server";
import { generateAgentVerifiableCredential } from "@/lib/credentials/portable-reputation";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { authenticateApiKey } from "@/lib/operator";
import { meterAttestation } from "@/lib/metering/attestation-meter";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*" };
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/metered/credentials/:commitment — premium, credit-metered portable
 * reputation credential issuance (Reputation-as-a-Service, 2.7).
 *
 * Unlike the free public GET /api/v1/credentials/:commitment, this endpoint is
 * authenticated and bills the operator's credit ledger for issuance, recording
 * a fully traceable meter entry. It is the metered product that monetizes the
 * trust moat without charging for raw token access.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized: a valid Bearer API key is required" },
      { status: 401, headers: { ...NO_STORE, ...CORS } }
    );
  }

  const { commitment } = await params;
  if (!isValidAgentCommitmentHash(commitment)) {
    return NextResponse.json(
      { error: "Invalid agent commitment hash" },
      { status: 400, headers: { ...NO_STORE, ...CORS } }
    );
  }

  // Meter the portable credential issuance product atomically against the ledger.
  const meter = await meterAttestation(
    operator.id,
    "portable_credential_issuance",
    commitment
  );
  if (!meter.allowed) {
    return NextResponse.json(
      {
        error: meter.reason ?? "Insufficient credits",
        product: meter.product,
        price_micros: meter.price_micros,
      },
      { status: 402, headers: { ...NO_STORE, ...CORS } }
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const vc = await generateAgentVerifiableCredential(commitment, origin);
  if (!vc) {
    return NextResponse.json(
      { error: "Agent not enrolled or no profile found" },
      { status: 404, headers: { ...NO_STORE, ...CORS } }
    );
  }

  return NextResponse.json(
    {
      credential: vc,
      meter: {
        product: meter.product,
        price_micros: meter.price_micros,
        credits_charged: meter.credits_charged,
        remaining_credits: meter.remaining_credits,
        meter_ref: meter.meter_ref,
      },
    },
    { status: 201, headers: { ...NO_STORE, ...CORS } }
  );
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
