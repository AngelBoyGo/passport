import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { requestWithdrawal } from "@/lib/bridge/withdraw";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * POST /api/v1/agent-pay/withdraw — burn ANGL and queue an on-chain payout to
 * the commitment's custodial wallet. Returns a proof-of-payout receipt id.
 * Body: { subject_commitment, amount, reference }
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { ...NO_STORE, ...CORS } });
  }

  const body = await request.json().catch(() => ({}));
  const subjectCommitment = String(body.subject_commitment ?? "").trim();
  const reference = String(body.reference ?? "").trim();
  const amount = Number(body.amount);

  if (!/^[0-9a-f]{64}$/i.test(subjectCommitment)) {
    return NextResponse.json({ error: "subject_commitment must be a 64-hex commitment" }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }
  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400, headers: { ...NO_STORE, ...CORS } });
  }

  try {
    const result = await requestWithdrawal({
      subjectCommitment,
      operatorId: operator.id,
      amount,
      reference,
      targetAddress: String(body.address ?? "").trim() || undefined,
      countryCode: String(body.country_code ?? "").trim().toUpperCase() || undefined,
      operatorKycStatus: (operator as { kycStatus?: string }).kycStatus,
    });
    if (!result.applied) {
      return NextResponse.json({ applied: false, reason: result.reason }, { status: 409, headers: { ...NO_STORE, ...CORS } });
    }
    return NextResponse.json(
      { applied: true, receipt_id: result.receipt_id, reference: result.reference },
      { status: 201, headers: { ...NO_STORE, ...CORS } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Withdrawal failed";
    const status = /Ownership|owned/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status, headers: { ...NO_STORE, ...CORS } });
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