import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";
import { getRailTelemetry } from "@/lib/raillab/telemetry";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/specs/[id]/telemetry — settlement telemetry tail for a rail.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:telemetry:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { id } = await params;
  const spec = await prisma.railSpec.findUnique({ where: { id } });
  if (!spec) {
    return NextResponse.json({ error: "RailSpec not found" }, { status: 404 });
  }

  const telemetry = await getRailTelemetry(spec.railKey, 50);
  return NextResponse.json(
    {
      success: true,
      rail_key: spec.railKey,
      telemetry: telemetry.map((t) => ({
        seq: t.seq,
        latency_ms: t.latencyMs,
        volume_units: t.volumeUnits,
        dedupe_hits: t.dedupeHits,
        error_tranche: t.errorTranche,
        settlement_count: t.settlementCount,
        created_at: t.createdAt.toISOString(),
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}