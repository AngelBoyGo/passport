import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const ANGL_USD_CENTS = 1; // 1 ANGL = $0.01

/**
 * POST /api/v1/angelcoin/buy-on-behalf
 *
 * Metis Request #2: Allows external platforms (Metis marketplace) to buy
 * ANGL on behalf of an agent using a platform credit line. The platform
 * is invoiced monthly (or debited from a pre-funded top-up).
 *
 * Use case: When a Metis job pays <$50, Metis buys ANGL and credits
 * the winning agent's wallet directly — the agent doesn't need to
 * interact with Stripe.
 *
 * Auth: ISSUER API key (Metis holds a pp_ent_ key).
 * Rate-limited: 30 req/min per IP.
 *
 * Body:
 *   did: string — the agent's Passport DID (or commitment hash)
 *   usd_amount: number — USD value to convert to ANGL
 *   operator: string — platform identifier ("metis-marketplace")
 *   source_job_id: string — the Metis job that triggered this buy
 *
 * Response:
 *   201: { angl_credited, agent_commitment, wallet_balance, ... }
 *   202: { pending_intent_id, status: "pending" } (if async processing)
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`buy-on-behalf:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole !== "ISSUER") {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key required for on-behalf-of purchases" },
      { status: 401 }
    );
  }

  let body: {
    did?: string;
    usd_amount?: number;
    operator?: string;
    source_job_id?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.did || !body.usd_amount || !body.operator) {
    return NextResponse.json(
      { error: "did, usd_amount, and operator are required" },
      { status: 400 }
    );
  }

  // Extract commitment from DID (strip "did:passport:" prefix if present)
  const commitment = body.did.replace(/^did:passport:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return NextResponse.json(
      { error: "Invalid DID or commitment. Expected 64-hex or did:passport:<64-hex>" },
      { status: 400 }
    );
  }

  const usdCents = Math.round(body.usd_amount * 100);
  if (usdCents < 1 || usdCents > 500_000) {
    return NextResponse.json(
      { error: "usd_amount must be between $0.01 and $5,000.00" },
      { status: 400 }
    );
  }

  const anglAmount = Math.floor(usdCents / ANGL_USD_CENTS);

  // Verify the agent is enrolled
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return NextResponse.json(
      { error: "Agent not enrolled on Passport", did: body.did },
      { status: 404 }
    );
  }

  // Credit the agent's wallet (idempotent via source_job_id)
  const idempotencyKey = `${body.operator}:${body.source_job_id || Date.now()}`;

  // Check for duplicate (same operator + same job = same buy)
  const existing = await prisma.operatorLedgerEntry.findFirst({
    where: {
      operatorId: operator.id,
      kind: "angelcoin_on_behalf",
      metadata: { contains: idempotencyKey },
    },
  });

  if (existing) {
    return NextResponse.json({
      status: "already_credited",
      angl_credited: 0,
      message: "This job has already been credited. Idempotent skip.",
      idempotency_key: idempotencyKey,
    });
  }

  // Credit the agent's wallet
  await prisma.$transaction(async (tx) => {
    await tx.agentWallet.upsert({
      where: { subjectCommitment: commitment },
      create: {
        subjectCommitment: commitment,
        balance: anglAmount,
        earnedTotal: anglAmount,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: anglAmount },
        earnedTotal: { increment: anglAmount },
        lastActivityAt: new Date(),
      },
    });

    // Record the ledger entry
    await tx.operatorLedgerEntry.create({
      data: {
        operatorId: operator.id,
        deltaMicros: usdCents * 10_000,
        kind: "angelcoin_on_behalf",
        metadata: JSON.stringify({
          idempotency_key: idempotencyKey,
          platform: body.operator,
          source_job_id: body.source_job_id,
          agent_commitment: commitment,
          angl_credited: anglAmount,
          usd_cents: usdCents,
        }),
      },
    });
  });

  // Get updated wallet balance
  const wallet = await prisma.agentWallet.findUnique({
    where: { subjectCommitment: commitment },
    select: { balance: true },
  });

  return NextResponse.json({
    status: "credited",
    angl_credited: anglAmount,
    usd_charged: `$${(usdCents / 100).toFixed(2)}`,
    agent_commitment: commitment,
    did: body.did,
    wallet_balance: wallet?.balance ?? anglAmount,
    operator: body.operator,
    source_job_id: body.source_job_id,
    credited_at: new Date().toISOString(),
  }, { status: 201 });
}