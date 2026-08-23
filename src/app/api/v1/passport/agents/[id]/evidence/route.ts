import { NextRequest, NextResponse } from "next/server";
import {
  checkEnrollmentRateLimit,
  clientIpFromRequest,
  getEnrollmentRateLimitMax,
  rateLimitResponse,
} from "@/lib/rateLimit";
import { requireTaskDeliverableServiceAuth } from "@/lib/enrollment/service-auth";
import { ingestEnrolledEvidence } from "@/lib/enrollment/evidence-binding";
import { enrollmentErrorResponse } from "@/lib/enrollment/route-errors";
import {
  enrollmentReasonCode,
  logPassportEvent,
} from "@/lib/observability/logger";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import {
  ingestEvidenceBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/enrollmentSchemas";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/passport/agents/:id/evidence — query evidence entries for a commitment hash.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    return NextResponse.json(
      { error: "agent_commitment_hash must be a full 64-character hex string" },
      { status: 400 }
    );
  }

  // H12 fix: cross-tenant reads are closed. A caller may only read evidence for
  // a commitment that belongs to an Agent row owned by THEIR operator. This
  // prevents any key-holder from pulling another operator's raw evidence.
  const ownedAgent = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: id },
    select: { id: true },
  });
  if (!ownedAgent) {
    return NextResponse.json(
      { error: "Evidence for this commitment is not owned by the authenticated operator" },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const sourceType = searchParams.get("source_type");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

  const entries = await prisma.agentEvidence.findMany({
    where: {
      agentIdentityCommitment: id,
      ...(sourceType ? { sourceType } : {}),
    },
    orderBy: { observedAt: "desc" },
    take: limit,
  });

  return NextResponse.json(entries);
}

/**
 * POST /api/v1/passport/agents/:id/evidence — authenticated enrolled evidence ingestion.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const ip = clientIpFromRequest(request.headers);
  const rate = checkEnrollmentRateLimit(`enroll-evidence:${ip}`);
  if (!rate.allowed) {
    logPassportEvent({
      event: "evidence_ingest",
      outcome: "rejected",
      http_status: 429,
      reason_code: "rate_limit_exceeded",
      rate_limited: true,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      rateLimitResponse(rate, getEnrollmentRateLimitMax())
    );
  }

  // Reject oversized payloads before parsing
  const contentLength = request.headers.get("content-length");
  const MAX_BODY_SIZE = 1_048_576; // 1 MB
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    logPassportEvent({
      event: "evidence_ingest",
      outcome: "rejected",
      http_status: 400,
      reason_code: "validation_error",
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "agent_commitment_hash must be a full 64-character hex string" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logPassportEvent({
      event: "evidence_ingest",
      outcome: "rejected",
      http_status: 400,
      reason_code: "invalid_json",
      subject_commitment: id,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ingestEvidenceBodySchema.safeParse(body);
  if (!parsed.success) {
    logPassportEvent({
      event: "evidence_ingest",
      outcome: "rejected",
      http_status: 400,
      reason_code: "validation_error",
      subject_commitment: id,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  const serviceAuthError = requireTaskDeliverableServiceAuth(
    request,
    parsed.data.source_type
  );
  if (serviceAuthError) {
    logPassportEvent({
      event: "evidence_ingest",
      outcome: "rejected",
      http_status: 401,
      reason_code: "service_auth_failed",
      subject_commitment: id,
      source_type: parsed.data.source_type,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return serviceAuthError;
  }

  try {
    const result = await ingestEnrolledEvidence({
      subjectCommitment: id,
      sourceType: parsed.data.source_type,
      payload: parsed.data.payload,
      signature: parsed.data.signature,
    });

    logPassportEvent({
      event: "evidence_ingest",
      outcome: "issued",
      http_status: 201,
      subject_commitment: id,
      source_type: parsed.data.source_type,
      event_commitment_hash: result.event_commitment_hash,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const mapped = enrollmentErrorResponse(err);
    if (mapped) {
      logPassportEvent({
        event: "evidence_ingest",
        outcome: "rejected",
        http_status: mapped.status,
        reason_code: enrollmentReasonCode(mapped.status),
        subject_commitment: id,
        source_type: parsed.data.source_type,
        rate_limited: false,
        latency_ms: Date.now() - startedAt,
      });
      return mapped;
    }
    logPassportEvent({
      event: "evidence_ingest",
      outcome: "error",
      http_status: 500,
      reason_code: "internal_error",
      subject_commitment: id,
      source_type: parsed.data.source_type,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    const message = err instanceof Error ? err.message : "Evidence ingest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
