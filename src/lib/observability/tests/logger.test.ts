import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";

const startEnrollmentMock = vi.fn();
const completeEnrollmentMock = vi.fn();
const ingestEnrolledEvidenceMock = vi.fn();
const logPassportEventMock = vi.fn();

vi.mock("@/lib/enrollment/enrollment-service", () => ({
  startEnrollment: (...args: unknown[]) => startEnrollmentMock(...args),
  completeEnrollment: (...args: unknown[]) => completeEnrollmentMock(...args),
  getPassport: vi.fn(),
}));

vi.mock("@/lib/enrollment/evidence-binding", () => ({
  ingestEnrolledEvidence: (...args: unknown[]) =>
    ingestEnrolledEvidenceMock(...args),
}));

vi.mock("@/lib/observability/logger", () => ({
  logPassportEvent: (...args: unknown[]) => logPassportEventMock(...args),
}));

const VALID_PK = "a".repeat(64);
const VALID_COMMITMENT = "b".repeat(64);
const VALID_SIG = "c".repeat(128);

beforeEach(async () => {
  vi.resetModules();
  logPassportEventMock.mockReset();
  startEnrollmentMock.mockReset();
  completeEnrollmentMock.mockReset();
  ingestEnrolledEvidenceMock.mockReset();

  const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
  resetInMemoryRateLimits();
});

describe("enrollment route logging", () => {
  it("logs enroll_start pending on success", async () => {
    startEnrollmentMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.PENDING,
      challengeNonce: "d".repeat(64),
      expiresAt: "2026-06-18T13:00:00.000Z",
    });

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );

    const response = await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: VALID_PK }),
      }) as import("next/server").NextRequest
    );

    expect(response.status).toBe(200);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "enroll_start",
        outcome: "pending",
        http_status: 200,
        subject_commitment: VALID_COMMITMENT,
        rate_limited: false,
      })
    );
  });

  it("logs enroll_start rejected on rate limit", async () => {
    process.env.ENROLLMENT_RATE_LIMIT_MAX = "1";

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    startEnrollmentMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.PENDING,
      challengeNonce: "d".repeat(64),
      expiresAt: "2026-06-18T13:00:00.000Z",
    });

    await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "198.51.100.77",
        },
        body: JSON.stringify({ public_key: VALID_PK }),
      }) as import("next/server").NextRequest
    );

    const blocked = await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "198.51.100.77",
        },
        body: JSON.stringify({ public_key: VALID_PK }),
      }) as import("next/server").NextRequest
    );

    expect(blocked.status).toBe(429);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "enroll_start",
        outcome: "rejected",
        http_status: 429,
        reason_code: "rate_limit_exceeded",
        rate_limited: true,
      })
    );

    delete process.env.ENROLLMENT_RATE_LIMIT_MAX;
  });

  it("logs enroll_complete issued on success", async () => {
    completeEnrollmentMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.ISSUED,
      issuedAt: "2026-06-18T12:00:00.000Z",
      publicKey: VALID_PK,
      context: "passport-v1",
    });

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/complete/route"
    );

    const response = await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_commitment: VALID_COMMITMENT,
          signature: VALID_SIG,
        }),
      }) as import("next/server").NextRequest
    );

    expect(response.status).toBe(200);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "enroll_complete",
        outcome: "issued",
        http_status: 200,
        subject_commitment: VALID_COMMITMENT,
      })
    );
  });

  it("logs evidence_ingest issued with event_commitment_hash on success", async () => {
    ingestEnrolledEvidenceMock.mockResolvedValue({
      event_commitment_hash: "e".repeat(64),
      enrollment_status: "ENROLLED",
    });

    const { POST } = await import(
      "@/app/api/v1/passport/agents/[id]/evidence/route"
    );

    const response = await POST(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/evidence`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_type: "compliance_report",
            payload: { report: { id: "r1" } },
            signature: VALID_SIG,
          }),
        }
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(201);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "evidence_ingest",
        outcome: "issued",
        http_status: 201,
        subject_commitment: VALID_COMMITMENT,
        source_type: "compliance_report",
        event_commitment_hash: "e".repeat(64),
      })
    );
  });
});
