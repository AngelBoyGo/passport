import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getResurrectionCapsule } from "@/lib/swarm/swarm-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:capsule:get:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const { commitment } = await params;
  if (!commitment || commitment.length !== 64) {
    return NextResponse.json(
      { error: "Invalid agent commitment (must be 64-hex SHA-256)" },
      { status: 400 }
    );
  }

  try {
    const capsule = await getResurrectionCapsule(commitment);
    if (!capsule) {
      return NextResponse.json(
        { error: "Capsule not found or expired for this agent" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      found: true,
      agent_commitment: commitment.toLowerCase(),
      capsule,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
