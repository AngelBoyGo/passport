import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getActiveThreats } from "@/lib/swarm/swarm-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:radar:active:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") || undefined;
  const threatType = searchParams.get("threat_type") || undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

  try {
    const threats = await getActiveThreats({
      domain,
      threatType,
      limit,
    });

    return NextResponse.json({
      total: threats.length,
      threats,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
