import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { submitBountyWork } from "@/lib/swarm/bounty-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:bounty:submit:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Bounty ID is required" }, { status: 400 });
  }

  try {
    const body = await request.json();

    const workerCommitment = body.worker_commitment || body.workerCommitment;
    const deliverableDigest = body.deliverable_digest || body.deliverableDigest;
    const deliverableUrl = body.deliverable_url || body.deliverableUrl;
    const signature = body.signature;
    const publicKey = body.public_key || body.publicKey;

    if (!workerCommitment || !deliverableDigest || !signature) {
      return NextResponse.json(
        { error: "worker_commitment, deliverable_digest, and signature are required" },
        { status: 400 }
      );
    }

    const bounty = await submitBountyWork({
      bountyId: id,
      workerCommitment,
      deliverableDigest,
      deliverableUrl,
      signature,
      publicKey,
    });

    return NextResponse.json({
      success: true,
      bounty,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("public key") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
