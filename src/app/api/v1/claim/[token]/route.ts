import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/claim/{token} — check claim token status.
 * Returns wallet info if the token is valid and unclaimed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const claim = await prisma.walletClaimToken.findUnique({
    where: { token },
  });

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  if (claim.claimed) {
    return NextResponse.json({ claimed: true });
  }

  if (claim.expiresAt < new Date()) {
    return NextResponse.json({ expired: true }, { status: 410 });
  }

  // Get the wallet balance
  const wallet = await prisma.agentWallet.findUnique({
    where: { subjectCommitment: claim.commitment },
    select: { balance: true },
  });

  return NextResponse.json({
    claimed: false,
    expired: false,
    commitment: claim.commitment,
    angl: wallet?.balance ?? 0,
    email: claim.email,
  });
}

/**
 * POST /api/v1/claim/{token} — claim the wallet.
 * Marks the token as claimed and links the wallet to the user's identity.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const claim = await prisma.walletClaimToken.findUnique({
    where: { token },
  });

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  if (claim.claimed) {
    return NextResponse.json({ status: "already_claimed" });
  }

  if (claim.expiresAt < new Date()) {
    return NextResponse.json({ error: "Claim link expired" }, { status: 410 });
  }

  await prisma.walletClaimToken.update({
    where: { token },
    data: { claimed: true, claimedAt: new Date() },
  });

  return NextResponse.json({
    status: "claimed",
    commitment: claim.commitment,
    claimed_at: new Date().toISOString(),
  });
}