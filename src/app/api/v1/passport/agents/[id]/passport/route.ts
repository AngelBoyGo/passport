import { NextRequest, NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { getPassport } from "@/lib/enrollment/enrollment-service";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { EnrollmentStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/passport/agents/:id/passport — read issued enrollment passport.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`enroll-passport:${ip}`);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: rate.retryAfterSec
          ? { "Retry-After": String(rate.retryAfterSec) }
          : undefined,
      }
    );
  }

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    return NextResponse.json(
      { error: "agent_commitment_hash must be a full 64-character hex string" },
      { status: 400 }
    );
  }

  const passport = await getPassport(id);
  if (!passport || passport.status !== EnrollmentStatus.ISSUED) {
    return NextResponse.json({ error: "Passport not found" }, { status: 404 });
  }

  return NextResponse.json({
    subject_commitment: passport.subjectCommitment,
    status: passport.status,
    issued_at: passport.issuedAt,
    public_key: passport.publicKey,
    context: passport.context,
    presentation: passport.presentation ?? null,
  });
}
