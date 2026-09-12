import { NextRequest, NextResponse } from "next/server";
import { bytesToHex } from "@noble/hashes/utils.js";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { openDispute } from "@/lib/agent-economy/dispute";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const STATUS_BY_CODE: Record<string, number> = {
  purchase_not_found: 404,
  not_party: 403,
  invalid_state: 409,
  invalid_reason: 400,
};

/**
 * POST /api/v1/compute/disputes — a buyer or provider opens a dispute over a DELIVERED purchase.
 * Body: { purchase_id, opened_by, reason, dispute_id? }
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:disputes:open:${ip}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 15));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const openedBy = String(body.opened_by ?? body.openedBy ?? "");
  const auth = await authorizeResource(request, { kind: "agent", id: openedBy });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const disputeId =
    (body.dispute_id ? String(body.dispute_id) : "") || `cd_${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;

  const result = await openDispute({
    disputeId,
    purchaseId: String(body.purchase_id ?? body.purchaseId ?? ""),
    openedBy,
    reason: String(body.reason ?? ""),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_code: result.code },
      { status: STATUS_BY_CODE[result.code] ?? 400, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    { success: true, dispute_id: result.disputeId, status: result.status },
    { status: 201, headers: NO_STORE }
  );
}
