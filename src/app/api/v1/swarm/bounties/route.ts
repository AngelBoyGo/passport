import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { createBounty, listBounties } from "@/lib/swarm/bounty-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:bounties:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  try {
    const body = await request.json();

    const creatorCommitment = body.creator_commitment || body.creatorCommitment;
    const title = body.title;
    const description = body.description;
    const bountyType = body.bounty_type || body.bountyType;
    const rewardAngel = body.reward_angel ?? body.rewardAngel;
    const signature = body.signature;
    const publicKey = body.public_key || body.publicKey;

    if (!creatorCommitment || !title || !description || rewardAngel === undefined || !signature) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: creator_commitment, title, description, reward_angel, signature",
        },
        { status: 400 }
      );
    }

    const bounty = await createBounty({
      creatorCommitment,
      title,
      description,
      bountyType,
      rewardAngel: Number(rewardAngel),
      signature,
      publicKey,
    });

    return NextResponse.json(
      {
        success: true,
        bounty,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("public key") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:bounties:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const bountyType = searchParams.get("bounty_type") || undefined;
  const creatorCommitment = searchParams.get("creator") || undefined;
  const workerCommitment = searchParams.get("worker") || undefined;
  const minRewardParam = searchParams.get("min_reward");
  const limitParam = searchParams.get("limit");

  const minReward = minRewardParam ? Number.parseInt(minRewardParam, 10) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

  try {
    const bounties = await listBounties({
      status,
      bountyType,
      creatorCommitment,
      workerCommitment,
      minReward,
      limit,
    });

    return NextResponse.json({
      total: bounties.length,
      bounties,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
