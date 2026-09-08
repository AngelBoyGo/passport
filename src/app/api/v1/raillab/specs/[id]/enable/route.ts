import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { enableRailSpec } from "@/lib/raillab/factory-agent";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/specs/[id]/enable — enable a SMOKE_TESTED rail.
 * Requires authentication AND an authorized_by signer; the transition is atomic + audit-logged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:enable:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const authorizedBy = String(body.authorized_by || body.authorizedBy || "").trim();

  if (!authorizedBy) {
    return NextResponse.json(
      { error: "authorized_by is required to enable a rail" },
      { status: 403, headers: NO_STORE }
    );
  }

  const { id } = await params;
  try {
    await enableRailSpec(id, authorizedBy);
    return NextResponse.json(
      { success: true, id, state: "ENABLED" },
      { status: 200, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /Illegal|moved under us/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}