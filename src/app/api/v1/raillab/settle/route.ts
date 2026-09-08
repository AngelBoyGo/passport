import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { settle } from "@/lib/raillab/settlement";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/settle — authenticated settlement webhook.
 * Auth: ISSUER API key or SCHEDULER_SECRET (x-scheduler-secret header).
 * Body: { rail_key, payload, signature, public_key?, reference }
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:settle:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const authHeader = request.headers.get("authorization");
  const schedulerSecret = process.env.SCHEDULER_SECRET;
  const providedSecret = request.headers.get("x-scheduler-secret");

  let authorized = false;
  if (schedulerSecret && providedSecret === schedulerSecret) {
    authorized = true;
  } else {
    const operator = await authenticateApiKey(authHeader);
    authorized = Boolean(operator && operator.apiKeyRole !== "HOLDER");
  }
  if (!authorized) {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key or SCHEDULER_SECRET required" },
      { status: 401, headers: NO_STORE }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const railKey = String(body.rail_key || body.railKey || "");
  const reference = String(body.reference || "");
  const signature = String(body.signature || "");
  const publicKey = body.public_key
    ? String(body.public_key)
    : undefined;
  const payload = (body.payload ?? {}) as Record<string, unknown>;

  if (!railKey || !reference || !signature || typeof payload !== "object") {
    return NextResponse.json(
      { error: "rail_key, reference, signature, and payload are required" },
      { status: 400 }
    );
  }

  try {
    const result = await settle(railKey, {
      payload,
      reference,
      signature,
      publicKey,
    });
    return NextResponse.json(
      {
        success: true,
        deduped: result.deduped,
        settlement_id: result.settlementId,
        rail_key: result.railKey,
        reference: result.reference,
        status: result.status,
        live: result.live,
        credited_angel: result.creditedAngel,
        error_tranche: result.errorTranche,
      },
      { status: result.deduped ? 200 : 201, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /signature rejected|not ENABLED|idempotency key|not found/i.test(message)
      ? 400
      : 422;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}