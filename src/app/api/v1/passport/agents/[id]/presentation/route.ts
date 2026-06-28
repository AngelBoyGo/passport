import { NextRequest, NextResponse } from "next/server";
import {
  checkEnrollmentRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { updatePresentation } from "@/lib/enrollment/presentation-service";
import { enrollmentErrorResponse } from "@/lib/enrollment/route-errors";
import {
  enrollmentReasonCode,
  logPassportEvent,
} from "@/lib/observability/logger";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import {
  updatePresentationBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/enrollmentSchemas";

export const dynamic = "force-dynamic";

/**
 * PUT /api/v1/passport/agents/:id/presentation — signed external photo reference update.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const ip = clientIpFromRequest(request.headers);
  const rate = checkEnrollmentRateLimit(`enroll-presentation:${ip}`);
  if (!rate.allowed) {
    logPassportEvent({
      event: "presentation_update",
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
      event: "presentation_update",
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
      event: "presentation_update",
      outcome: "rejected",
      http_status: 400,
      reason_code: "invalid_json",
      subject_commitment: id,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updatePresentationBodySchema.safeParse(body);
  if (!parsed.success) {
    logPassportEvent({
      event: "presentation_update",
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
    const result = await updatePresentation({
      subjectCommitment: id,
      photoUrl: parsed.data.photo_url,
      photoContentSha256: parsed.data.photo_content_sha256,
      photoMimeType: parsed.data.photo_mime_type,
      signature: parsed.data.signature,
    });

    logPassportEvent({
      event: "presentation_update",
      outcome: "issued",
      http_status: 200,
      subject_commitment: id,
      photo_content_sha256: result.presentation?.content_sha256 ?? undefined,
      cleared: result.presentation === null,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });

    return NextResponse.json(result);
  } catch (err) {
    const mapped = enrollmentErrorResponse(err);
    if (mapped) {
      logPassportEvent({
        event: "presentation_update",
        outcome: "rejected",
        http_status: mapped.status,
        reason_code: enrollmentReasonCode(mapped.status),
        subject_commitment: id,
        rate_limited: false,
        latency_ms: Date.now() - startedAt,
      });
      return mapped;
    }
    logPassportEvent({
      event: "presentation_update",
      outcome: "error",
      http_status: 500,
      reason_code: "internal_error",
      subject_commitment: id,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    const message =
      err instanceof Error ? err.message : "Presentation update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
