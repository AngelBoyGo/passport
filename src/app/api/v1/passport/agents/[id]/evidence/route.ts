import { NextRequest, NextResponse } from "next/server";
import {
  checkEnrollmentRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
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

export const dynamic = "force-dynamic";

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
