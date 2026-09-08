import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { quarantineRailSpec } from "@/lib/raillab/factory-agent";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/specs/[id]/quarantine — quarantine an ENABLED rail (auth'd).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:quarantine:${ip}`, 30, 60_000);
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
  const reason = String(body.reason || "manual quarantine").slice(0, 1000);

  const { id } = await params;
  try {
    await quarantineRailSpec(id, reason);
    return NextResponse.json(
      { success: true, id, state: "QUARANTINED" },
      { status: 200, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /Illegal|moved under us/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}