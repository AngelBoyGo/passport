import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { completeBounty } from "@/lib/swarm/bounty-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:bounty:complete:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Bounty ID is required" }, { status: 400 });
  }

  try {
    const body = await request.json();

    const verifierCommitment = body.verifier_commitment || body.verifierCommitment;
    const signature = body.signature;
    const publicKey = body.public_key || body.publicKey;

    if (!verifierCommitment || !signature) {
      return NextResponse.json(
        { error: "verifier_commitment and signature are required" },
        { status: 400 }
      );
    }

    const result = await completeBounty({
      bountyId: id,
      verifierCommitment,
      signature,
      publicKey,
    });

    return NextResponse.json({
      success: true,
      bounty: result.bounty,
      payout_angel: result.payoutAngel,
      fee_angel: result.feeAngel,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("public key") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
