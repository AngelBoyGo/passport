import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { settleMobileMoneyOnramp } from "@/lib/digital-gateway/mobile-money";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/v1/digital/onramp
 * Key-authenticated agent top-up (autonomous-agent adoption lane). Same settlement
 * path as mobile-money, but the caller identity is the authenticated operator.
 * Body: { xof_amount, reference }
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { ...NO_STORE, ...CORS } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const xofAmount = Number(body.xof_amount ?? body.xofAmount);
  const reference = String(body.reference ?? body.external_ref ?? body.externalRef ?? "");
  const targetCommitment = String(
    body.target_commitment || body.targetCommitment || ""
  ).trim();

  if (!Number.isFinite(xofAmount) || xofAmount <= 0) {
    return NextResponse.json({ error: "xof_amount must be a positive integer" }, { status: 400 });
  }
  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 });
  }
  if (targetCommitment && !/^[0-9a-f]{64}$/i.test(targetCommitment)) {
    return NextResponse.json(
      { error: "target_commitment must be a 64-hex commitment" },
      { status: 400 }
    );
  }

  try {
    const result = await settleMobileMoneyOnramp({
      provider: "agent_api",
      payload: { external_reference: reference, amount: Math.round(xofAmount) },
      targetCommitment: targetCommitment || undefined,
      internal: true,
    });

    return NextResponse.json(
      {
        success: true,
        deduped: result.deduped,
        settlement_id: result.settlementId,
        external_ref: result.externalRef,
        xof_amount: result.xofAmount,
        credited_angel: result.creditedAngel,
        target_commitment: result.targetCommitment,
        status: result.status,
      },
      { status: result.deduped ? 200 : 201, headers: { ...NO_STORE, ...CORS } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
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