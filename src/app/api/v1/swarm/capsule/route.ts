import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { saveResurrectionCapsule } from "@/lib/swarm/swarm-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:capsule:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  try {
    const body = await request.json();

    const agentCommitment = body.agent_commitment || body.agentCommitment;
    const encryptedPayload = body.encrypted_payload || body.encryptedPayload;
    const signature = body.signature;
    const publicKey = body.public_key || body.publicKey;
    const ttlHours = body.ttl_hours || body.ttlHours;

    if (!agentCommitment || typeof agentCommitment !== "string") {
      return NextResponse.json({ error: "agent_commitment is required" }, { status: 400 });
    }

    if (!encryptedPayload || typeof encryptedPayload !== "string") {
      return NextResponse.json(
        { error: "encrypted_payload (ciphertext/base64) is required" },
        { status: 400 }
      );
    }

    if (!signature || typeof signature !== "string") {
      return NextResponse.json(
        { error: "Ed25519 signature of payload digest is required" },
        { status: 400 }
      );
    }

    const saved = await saveResurrectionCapsule({
      agentCommitment,
      encryptedPayload,
      signature,
      publicKey,
      ttlHours,
    });

    return NextResponse.json(
      {
        success: true,
        capsule_id: saved.id,
        agent_commitment: agentCommitment.trim().toLowerCase(),
        version: saved.version,
        expires_at: saved.expiresAt,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("public key") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
