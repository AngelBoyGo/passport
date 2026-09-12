import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import {
  declareCapability,
  listAgentCapabilities,
  retireCapability,
  type CapabilityInput,
} from "@/lib/agent-economy/capability-registry";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/v1/agents/[commitment]/capabilities — public list of an agent's declared capabilities.
 * Owner/ISSUER may pass `?all=true` to include retired ones.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agents:capabilities:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { commitment } = await params;
  const { searchParams } = new URL(request.url);
  const includeAll = searchParams.get("all") === "true";

  // Public read: active-only. `all=true` requires ownership (enforced below).
  let activeOnly = true;
  if (includeAll) {
    const auth = await authorizeResource(request, { kind: "agent", id: commitment });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
    }
    activeOnly = false;
  }

  const capabilities = await listAgentCapabilities(commitment, { activeOnly });
  return NextResponse.json(
    { success: true, agent_commitment: commitment, count: capabilities.length, capabilities },
    { headers: { "Cache-Control": "public, max-age=15", "Access-Control-Allow-Origin": "*" } }
  );
}

/**
 * POST /api/v1/agents/[commitment]/capabilities — declare/update a capability. Owner or ISSUER.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agents:capabilities:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { commitment } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const input: CapabilityInput = {
    capability: String(body.capability ?? ""),
    description: body.description != null ? String(body.description) : null,
    version: body.version != null ? String(body.version) : null,
    endpointUrl: body.endpoint_url != null ? String(body.endpoint_url) : null,
    priceAngel: body.price_angel != null ? Number(body.price_angel) : undefined,
    unit: body.unit != null ? String(body.unit) : undefined,
    metadata: (body.metadata as Record<string, unknown>) ?? null,
    active: typeof body.active === "boolean" ? body.active : undefined,
  };

  try {
    const capability = await declareCapability(commitment, input);
    return NextResponse.json({ success: true, capability }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid capability" },
      { status: 400, headers: NO_STORE }
    );
  }
}

/** DELETE /api/v1/agents/[commitment]/capabilities?capability=... — retire a capability. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agents:capabilities:delete:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { commitment } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const capability = new URL(request.url).searchParams.get("capability");
  if (!capability) {
    return NextResponse.json({ error: "capability query param required" }, { status: 400, headers: NO_STORE });
  }

  const retired = await retireCapability(commitment, capability);
  return NextResponse.json({ success: retired, capability }, { headers: NO_STORE });
}
