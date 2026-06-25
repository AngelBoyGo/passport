import { NextRequest, NextResponse } from "next/server";
import {
  checkEnrollmentRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { completeEnrollment } from "@/lib/enrollment/enrollment-service";
import { enrollmentErrorResponse } from "@/lib/enrollment/route-errors";
import {
  enrollmentReasonCode,
  logPassportEvent,
} from "@/lib/observability/logger";
import {
  enrollCompleteBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/enrollmentSchemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/agents/enroll/complete — finish enrollment with signed challenge.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const ip = clientIpFromRequest(request.headers);
  const rate = checkEnrollmentRateLimit(`enroll-complete:${ip}`);
  if (!rate.allowed) {
    logPassportEvent({
      event: "enroll_complete",
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logPassportEvent({
      event: "enroll_complete",
      outcome: "rejected",
      http_status: 400,
      reason_code: "invalid_json",
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = enrollCompleteBodySchema.safeParse(body);
  if (!parsed.success) {
    logPassportEvent({
      event: "enroll_complete",
      outcome: "rejected",
      http_status: 400,
      reason_code: "validation_error",
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  try {
    const result = await completeEnrollment(
      parsed.data.subject_commitment,
      parsed.data.signature
    );

    logPassportEvent({
      event: "enroll_complete",
      outcome: "issued",
      http_status: 200,
      subject_commitment: result.subjectCommitment,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      subject_commitment: result.subjectCommitment,
      status: result.status,
      issued_at: result.issuedAt,
      public_key: result.publicKey,
      context: result.context,
    });
  } catch (err) {
    const mapped = enrollmentErrorResponse(err);
    if (mapped) {
      logPassportEvent({
        event: "enroll_complete",
        outcome: "rejected",
        http_status: mapped.status,
        reason_code: enrollmentReasonCode(mapped.status),
        subject_commitment: parsed.data.subject_commitment,
        rate_limited: false,
        latency_ms: Date.now() - startedAt,
      });
      return mapped;
    }
    logPassportEvent({
      event: "enroll_complete",
      outcome: "error",
      http_status: 500,
      reason_code: "internal_error",
      subject_commitment: parsed.data.subject_commitment,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    const message =
      err instanceof Error ? err.message : "Enrollment complete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
