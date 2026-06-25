import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";

const startEnrollmentMock = vi.fn();

vi.mock("@/lib/enrollment/enrollment-service", () => ({
  startEnrollment: (...args: unknown[]) => startEnrollmentMock(...args),
  completeEnrollment: vi.fn(),
  getPassport: vi.fn(),
}));

const VALID_PK = "a".repeat(64);
const VALID_COMMITMENT = "b".repeat(64);

describe("enrollment rate limit config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ENROLLMENT_RATE_LIMIT_MAX;
    delete process.env.ENROLLMENT_RATE_LIMIT_WINDOW_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to 30 requests per 60s window", async () => {
    const {
      getEnrollmentRateLimitMax,
      getEnrollmentRateLimitWindowMs,
    } = await import("@/lib/rateLimit");

    expect(getEnrollmentRateLimitMax()).toBe(30);
    expect(getEnrollmentRateLimitWindowMs()).toBe(60_000);
  });

  it("reads ENROLLMENT_RATE_LIMIT_MAX and ENROLLMENT_RATE_LIMIT_WINDOW_MS from env lazily", async () => {
    process.env.ENROLLMENT_RATE_LIMIT_MAX = "5";
    process.env.ENROLLMENT_RATE_LIMIT_WINDOW_MS = "10000";

    const {
      getEnrollmentRateLimitMax,
      getEnrollmentRateLimitWindowMs,
    } = await import("@/lib/rateLimit");

    expect(getEnrollmentRateLimitMax()).toBe(5);
    expect(getEnrollmentRateLimitWindowMs()).toBe(10_000);
  });

  it("clamps invalid env values to safe defaults", async () => {
    process.env.ENROLLMENT_RATE_LIMIT_MAX = "0";
    process.env.ENROLLMENT_RATE_LIMIT_WINDOW_MS = "abc";

    const {
      getEnrollmentRateLimitMax,
      getEnrollmentRateLimitWindowMs,
    } = await import("@/lib/rateLimit");

    expect(getEnrollmentRateLimitMax()).toBe(30);
    expect(getEnrollmentRateLimitWindowMs()).toBe(60_000);
  });
});

describe("enrollment route rate limiting", () => {
  beforeEach(async () => {
    vi.resetModules();
    startEnrollmentMock.mockReset();
    delete process.env.ENROLLMENT_RATE_LIMIT_MAX;
    delete process.env.ENROLLMENT_RATE_LIMIT_WINDOW_MS;

    startEnrollmentMock.mockResolvedValue({
      subjectCommitment: VALID_COMMITMENT,
      status: EnrollmentStatus.PENDING,
      challengeNonce: "d".repeat(64),
      expiresAt: "2026-06-18T13:00:00.000Z",
    });

    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();
  });

  function enrollStartRequest(ip = "203.0.113.99") {
    return new Request("http://localhost/api/v1/passport/agents/enroll/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ public_key: VALID_PK }),
    });
  }

  it("returns 429 with Retry-After when enroll/start exceeds the limit", async () => {
    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );

    for (let i = 0; i < 30; i++) {
      const response = await POST(
        enrollStartRequest() as import("next/server").NextRequest
      );
      expect(response.status).toBe(200);
    }

    const blocked = await POST(
      enrollStartRequest() as import("next/server").NextRequest
    );
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(body).toEqual({ error: "Rate limit exceeded" });
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("honors ENROLLMENT_RATE_LIMIT_MAX override on enroll/start", async () => {
    process.env.ENROLLMENT_RATE_LIMIT_MAX = "2";

    const { POST } = await import(
      "@/app/api/v1/passport/agents/enroll/start/route"
    );
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();

    await POST(enrollStartRequest() as import("next/server").NextRequest);
    await POST(enrollStartRequest() as import("next/server").NextRequest);

    const blocked = await POST(
      enrollStartRequest() as import("next/server").NextRequest
    );
    expect(blocked.status).toBe(429);
  });
});
