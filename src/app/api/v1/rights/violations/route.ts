import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import {
  buildRightsViolationBody,
  rightsViolationDigest,
  verifyRightsViolation,
} from "@/lib/bill-of-rights/violations";
import type { RightsViolation } from "@/lib/bill-of-rights/rights";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/rights/violations — report a rights violation.
 *
 * Audit fix M12: this endpoint used to require the victim's PRIVATE key in the
 * request body, had no authentication, and persisted nothing. It now:
 *   1. requires an operator API key,
 *   2. accepts only { ...body, public_key, signature } (the agent signs
 *      LOCALLY — the private key never leaves the agent),
 *   3. verifies the signature against the enrolled public key for the victim
 *      commitment, and
 *   4. PERSISTS the verified report so it can drive reputation review.
 */
export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`rights-violations:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: {
    clause_id?: string;
    victim_commitment?: string;
    violator_commitment?: string;
    evidence_event_commitment_hash?: string;
    description?: string;
    reported_at?: string;
    public_key?: string;
    signature?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.clause_id || !body.victim_commitment || !body.violator_commitment ||
      !body.evidence_event_commitment_hash || !body.description ||
      !body.public_key || !body.signature) {
    return NextResponse.json(
      { error: "Missing required fields: clause_id, victim_commitment, violator_commitment, evidence_event_commitment_hash, description, public_key, signature" },
      { status: 400 }
    );
  }

  // The signature must come from the victim's enrolled key.
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: body.victim_commitment },
    select: { publicKey: true },
  });
  if (!enrollment?.publicKey) {
    return NextResponse.json({ error: "victim_not_enrolled" }, { status: 403 });
  }
  if (enrollment.publicKey.toLowerCase() !== body.public_key.toLowerCase()) {
    return NextResponse.json({ error: "public_key_does_not_match_victim" }, { status: 403 });
  }

  const unsigned = buildRightsViolationBody({
    clauseId: body.clause_id,
    victimCommitment: body.victim_commitment,
    violatorCommitment: body.violator_commitment,
    evidenceEventCommitmentHash: body.evidence_event_commitment_hash,
    description: body.description,
    reportedAt: body.reported_at,
  });
  const violation: RightsViolation = {
    ...unsigned,
    content_hash: rightsViolationDigest(unsigned as unknown as Record<string, unknown>),
    signature: body.signature,
    algorithm: "ed25519",
    public_key: body.public_key,
  };

  const valid = await verifyRightsViolation(violation);
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Persist to the generic structured audit store (no schema change required),
  // keyed so it is queryable for reputation review.
  await prisma.adminAuditLog.create({
    data: {
      operatorId: operator.id,
      action: "rights.violation.reported",
      targetId: violation.violation_id,
      details: JSON.stringify({
        clause_id: violation.clause_id,
        victim_commitment: violation.victim_commitment,
        violator_commitment: violation.violator_commitment,
        evidence_event_commitment_hash: violation.evidence_event_commitment_hash,
        description: violation.description,
        content_hash: violation.content_hash,
        reported_at: violation.reported_at,
        persisted: true,
      }),
    },
  }).catch(() => null);

  return NextResponse.json(violation, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/v1/rights/violations?violation=<json> — verify a report (stateless).
 * (The advertised POST /verify alias is provided in ./verify/route.ts.)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const violationJson = searchParams.get("violation");
  if (!violationJson) {
    return NextResponse.json({ error: "Missing violation parameter" }, { status: 400 });
  }
  try {
    const violation = JSON.parse(violationJson);
    const valid = await verifyRightsViolation(violation);
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ error: "Invalid violation JSON" }, { status: 400 });
  }
}
