import { NextRequest, NextResponse } from "next/server";
import {
  checkEnrollmentRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { startEnrollment } from "@/lib/enrollment/enrollment-service";
import { enrollmentErrorResponse } from "@/lib/enrollment/route-errors";
import {
  enrollmentReasonCode,
  logPassportEvent,
} from "@/lib/observability/logger";
import {
  enrollStartBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/enrollmentSchemas";
import { EnrollmentStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/passport/agents/enroll/start — begin proof-based enrollment.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const ip = clientIpFromRequest(request.headers);
  const rate = checkEnrollmentRateLimit(`enroll-start:${ip}`);
  if (!rate.allowed) {
    logPassportEvent({
      event: "enroll_start",
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
      event: "enroll_start",
      outcome: "rejected",
      http_status: 400,
      reason_code: "invalid_json",
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = enrollStartBodySchema.safeParse(body);
  if (!parsed.success) {
    logPassportEvent({
      event: "enroll_start",
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
    const result = await startEnrollment(
      parsed.data.public_key,
      parsed.data.context
    );

    const response: Record<string, unknown> = {
      subject_commitment: result.subjectCommitment,
      status: result.status,
    };

    if (result.status === EnrollmentStatus.ISSUED) {
      response.issued_at = result.issuedAt;
      response.public_key = result.publicKey;
      response.context = result.context;
    } else {
      response.challenge_nonce = result.challengeNonce;
      response.expires_at = result.expiresAt;
    }

    logPassportEvent({
      event: "enroll_start",
      outcome:
        result.status === EnrollmentStatus.ISSUED ? "issued" : "pending",
      http_status: 200,
      subject_commitment: result.subjectCommitment,
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });

    return NextResponse.json(response);
  } catch (err) {
    const mapped = enrollmentErrorResponse(err);
    if (mapped) {
      logPassportEvent({
        event: "enroll_start",
        outcome: "rejected",
        http_status: mapped.status,
        reason_code: enrollmentReasonCode(mapped.status),
        rate_limited: false,
        latency_ms: Date.now() - startedAt,
      });
      return mapped;
    }
    logPassportEvent({
      event: "enroll_start",
      outcome: "error",
      http_status: 500,
      reason_code: "internal_error",
      rate_limited: false,
      latency_ms: Date.now() - startedAt,
    });
    const message = err instanceof Error ? err.message : "Enrollment start failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
