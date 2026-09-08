import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import { executeRailSettlement } from "@/lib/raillab/executor";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/specs/[id]/execute — one-off settlement execution for an ENABLED rail.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:execute:${ip}`, 30, 60_000);
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

  const { id } = await params;
  const spec = await prisma.railSpec.findUnique({ where: { id } });
  if (!spec) {
    return NextResponse.json({ error: "RailSpec not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const result = await executeRailSettlement(spec.railKey, { payload: body });
    return NextResponse.json(
      {
        success: result.ok,
        live: result.live,
        stage: result.stage,
        credited_angel: result.creditedAngel,
        error_tranche: result.errorTranche,
        detail: result.detail,
      },
      { status: result.ok ? 200 : 422, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}