import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperationalDomain } from "@prisma/client";

const resolveOperatorByPublicIdMock = vi.fn();
const verifyGatePassMock = vi.fn();

vi.mock("@/lib/operator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator")>();
  return {
    ...actual,
    resolveOperatorByPublicId: (...args: unknown[]) =>
      resolveOperatorByPublicIdMock(...args),
  };
});

vi.mock("@/lib/gate/verifyGatePass", () => ({
  verifyGatePass: (...args: unknown[]) => verifyGatePassMock(...args),
}));

beforeEach(async () => {
  vi.resetModules();
  resolveOperatorByPublicIdMock.mockReset();
  verifyGatePassMock.mockReset();

  const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
  resetInMemoryRateLimits();

  resolveOperatorByPublicIdMock.mockResolvedValue({
    id: "db_op_rate",
    stripeCustomerId: "cus_rate_test",
  });
  verifyGatePassMock.mockResolvedValue({ allow_invocation: true });
});

function gateVerifyRequest(ip = "203.0.113.50") {
  return new Request("http://localhost/api/v1/gate/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({
      operator_id: "op_cus_rate_test",
      domain: OperationalDomain.FINANCIAL_CLEARING,
    }),
  });
}

describe("POST /api/v1/gate/verify rate limiting", () => {
  it("returns 429 when request rate exceeds threshold per IP", async () => {
    const { POST } = await import("@/app/api/v1/gate/verify/route");

    for (let i = 0; i < 30; i++) {
      const response = await POST(
        gateVerifyRequest() as import("next/server").NextRequest
      );
      expect(response.status).toBe(200);
    }

    const blocked = await POST(
      gateVerifyRequest() as import("next/server").NextRequest
    );
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(body).toEqual({ error: "Rate limit exceeded" });
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("tracks rate limits independently per IP", async () => {
    const { POST } = await import("@/app/api/v1/gate/verify/route");

    for (let i = 0; i < 30; i++) {
      await POST(
        gateVerifyRequest("198.51.100.1") as import("next/server").NextRequest
      );
    }

    const otherIp = await POST(
      gateVerifyRequest("198.51.100.2") as import("next/server").NextRequest
    );
    expect(otherIp.status).toBe(200);
  });
});
