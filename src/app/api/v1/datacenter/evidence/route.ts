import { NextRequest, NextResponse } from "next/server";
import {
  ingestDataCenterTelemetry,
  type DataCenterTelemetryPayload,
} from "@/lib/datacenter/datacenter-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CORS = { "Access-Control-Allow-Origin": "*" };

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`datacenter:evidence:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  // ── AUTHENTICATION (MANDATORY) ─────────────────────────────────────────
  // Data center telemetry is a privileged write path. It MUST NOT accept
  // unauthenticated writes: unknown parties must not be able to anchor
  // evidence or poison any facility's energy / carbon reputation ledger.
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized: a valid Bearer API key is required to ingest data center telemetry" },
      { status: 401, headers: { ...NO_STORE, ...CORS } }
    );
  }

  // ── AUTHORIZATION (DUAL-TIER RBAC) ─────────────────────────────────────────
  // Only Enterprise/Platform Issuer keys (pp_ent_) may anchor fleet telemetry
  // for arbitrary clusters. Holder keys (pp_usr_) are bound to a single subject
  // identity and are not permitted to write multi-tenant facility evidence.
  if (operator.apiKeyRole === "HOLDER") {
    return NextResponse.json(
      {
        error:
          "Forbidden: Holder (pp_usr_) keys cannot anchor fleet telemetry. Use an Enterprise Issuer (pp_ent_) key.",
      },
      { status: 403, headers: { ...NO_STORE, ...CORS } }
    );
  }

  try {
    const body = (await request.json()) as DataCenterTelemetryPayload;

    if (!body.cluster_id || !body.event_type || !body.origin) {
      return NextResponse.json(
        { error: "Missing required fields: cluster_id, event_type, origin" },
        { status: 400, headers: { ...NO_STORE, ...CORS } }
      );
    }

    const result = await ingestDataCenterTelemetry(body, operator.id);

    return NextResponse.json(result, {
      status: 201,
      headers: { ...NO_STORE, ...CORS },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, headers: { ...NO_STORE, ...CORS } });
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