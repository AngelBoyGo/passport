import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { publishSwarmMemory, querySwarmMemory } from "@/lib/swarm/swarm-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:memory:post:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  try {
    const body = await request.json();

    const agentCommitment = body.agent_commitment || body.agentCommitment;
    const topic = body.topic;
    const payload = body.payload;
    const signature = body.signature;
    const channel = body.channel || "global";
    const parentHash = body.parent_hash || body.parentHash;
    const publicKey = body.public_key || body.publicKey;

    if (!agentCommitment || typeof agentCommitment !== "string") {
      return NextResponse.json(
        { error: "agent_commitment (64 hex characters) is required" },
        { status: 400 }
      );
    }

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    if (payload === undefined || payload === null) {
      return NextResponse.json({ error: "payload is required" }, { status: 400 });
    }

    if (!signature || typeof signature !== "string") {
      return NextResponse.json(
        { error: "Ed25519 signature of payload digest is required" },
        { status: 400 }
      );
    }

    const memory = await publishSwarmMemory({
      agentCommitment,
      channel,
      topic,
      payload,
      signature,
      parentHash,
      publicKey,
    });

    return NextResponse.json(
      {
        success: true,
        memory_id: memory.id,
        agent_commitment: memory.agentCommitment,
        channel: memory.channel,
        topic: memory.topic,
        payload_digest: memory.payloadDigest,
        created_at: memory.createdAt,
        verified: memory.verified,
        fee_deducted: memory.feeDeducted,
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
  const rate = await checkRateLimit(`swarm:memory:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") || undefined;
  const topic = searchParams.get("topic") || undefined;
  const agentCommitment = searchParams.get("agent") || undefined;
  const parentHash = searchParams.get("parent_hash") || undefined;
  const sinceParam = searchParams.get("since");
  const limitParam = searchParams.get("limit");

  const since = sinceParam ? new Date(sinceParam) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

  try {
    const memories = await querySwarmMemory({
      channel,
      topic,
      agentCommitment,
      parentHash,
      since,
      limit,
    });

    return NextResponse.json({
      channel: channel || "all",
      total: memories.length,
      memories,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
