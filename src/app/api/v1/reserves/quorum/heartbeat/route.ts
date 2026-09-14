import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { registerStateHeartbeat } from "@/lib/reserves/threshold-quorum";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/reserves/quorum/heartbeat — Register a sovereign state heartbeat.
 *
 * A sovereign state ministry node sends a signed heartbeat to prove it is online.
 * The Ed25519 signature is verified against the state's registered key
 * (SOVEREIGN_KEY_ML/BF/NE env).
 *
 * Auth: ISSUER API key or x-scheduler-secret.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:quorum:heartbeat:${ip}`, 30, 60_000);
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const countryCode = String(body.country_code ?? body.countryCode ?? "");
  const nodeEndpoint = String(body.node_endpoint ?? body.nodeEndpoint ?? "");
  const heartbeatNonce = String(body.heartbeat_nonce ?? body.heartbeatNonce ?? "");
  const signature = String(body.signature ?? "");

  if (!countryCode || !nodeEndpoint || !heartbeatNonce || !signature) {
    return NextResponse.json(
      { error: "country_code, node_endpoint, heartbeat_nonce, and signature are required" },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const hb = await registerStateHeartbeat({
      countryCode,
      nodeEndpoint,
      heartbeatNonce,
      signature,
    });
    return NextResponse.json(
      {
        success: true,
        country_code: hb.countryCode,
        node_endpoint: hb.nodeEndpoint,
        status: hb.status,
        last_seen_at: hb.lastSeenAt.toISOString(),
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Heartbeat registration failed";
    const status = message.includes("Invalid") || message.includes("registered") ? 401 : 400;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}