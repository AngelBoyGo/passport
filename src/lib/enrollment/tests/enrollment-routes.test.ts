import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";

const startEnrollmentMock = vi.fn();
const completeEnrollmentMock = vi.fn();
const getPassportMock = vi.fn();

vi.mock("@/lib/enrollment/enrollment-service", () => ({
  startEnrollment: (...args: unknown[]) => startEnrollmentMock(...args),
  completeEnrollment: (...args: unknown[]) => completeEnrollmentMock(...args),
  getPassport: (...args: unknown[]) => getPassportMock(...args),
}));

import {
  ChallengeExpiredError,
  ChallengeNotFoundError,
  InvalidEnrollmentInputError,
  InvalidEnrollmentProofError,
} from "@/lib/enrollment/errors";

const VALID_PK = "a".repeat(64);
const VALID_COMMITMENT = "b".repeat(64);
const VALID_SIG = "c".repeat(128);

beforeEach(() => {
  vi.resetModules();
  startEnrollmentMock.mockReset();
  completeEnrollmentMock.mockReset();
  getPassportMock.mockReset();
});

describe("POST /api/v1/passport/agents/enroll/start", () => {
  it("returns challenge on happy path", async () => {
    startEnrollmentMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.PENDING,
      challengeNonce: "d".repeat(64),
      expiresAt: "2026-06-18T13:00:00.000Z",
    });

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    const response = await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: VALID_PK }),
      }) as import("next/server").NextRequest
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subject_commitment).toBe(VALID_COMMITMENT);
    expect(body.challenge_nonce).toBe("d".repeat(64));
    expect(body.status).toBe(EnrollmentStatus.PENDING);
  });

  it("returns 400 on malformed body", async () => {
    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    const response = await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: "bad" }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(400);
  });

  it("returns idempotent ISSUED passport without challenge", async () => {
    startEnrollmentMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.ISSUED,
      issuedAt: "2026-06-18T12:00:00.000Z",
      publicKey: VALID_PK,
      context: "passport-v1",
    });

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    const response = await POST(
      new Request("http://localhost/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: VALID_PK }),
      }) as import("next/server").NextRequest
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(EnrollmentStatus.ISSUED);
    expect(body.challenge_nonce).toBeUndefined();
  });
});

describe("POST /api/v1/passport/agents/enroll/complete", () => {
  it("returns issued passport on valid proof", async () => {
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
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

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
    const body = await response.json();
    expect(body.status).toBe(EnrollmentStatus.ISSUED);
    expect(body.public_key).toBe(VALID_PK);
  });

  it("maps invalid proof to 401", async () => {
    completeEnrollmentMock.mockRejectedValue(new InvalidEnrollmentProofError());

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/complete/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

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
    expect(response.status).toBe(401);
  });

  it("maps missing challenge to 404", async () => {
    completeEnrollmentMock.mockRejectedValue(new ChallengeNotFoundError());

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/complete/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

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
    expect(response.status).toBe(404);
  });

  it("maps expired challenge to 410", async () => {
    completeEnrollmentMock.mockRejectedValue(new ChallengeExpiredError());

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/complete/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

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
    expect(response.status).toBe(410);
  });
});

describe("GET /api/v1/passport/agents/[id]/passport", () => {
  it("returns issued passport", async () => {
    getPassportMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.ISSUED,
      issuedAt: "2026-06-18T12:00:00.000Z",
      publicKey: VALID_PK,
      context: "passport-v1",
    });

    const { GET } = await import(
      "@/app/api/v1/passport/agents/[id]/passport/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/passport`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(EnrollmentStatus.ISSUED);
  });

  it("returns 404 when unknown", async () => {
    getPassportMock.mockResolvedValue(null);

    const { GET } = await import(
      "@/app/api/v1/passport/agents/[id]/passport/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_COMMITMENT}/passport`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_COMMITMENT }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid id", async () => {
    const { GET } = await import(
      "@/app/api/v1/passport/agents/[id]/passport/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    const response = await GET(
      new Request("http://localhost/api/v1/passport/agents/bad/passport") as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "bad" }) }
    );
    expect(response.status).toBe(400);
  });
});
