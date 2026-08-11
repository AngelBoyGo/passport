import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKeyMock = vi.fn();
const operatorFindUniqueMock = vi.fn();
const apiKeyCountMock = vi.fn();
const receiptCountMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    operator: { findUnique: (...args: unknown[]) => operatorFindUniqueMock(...args) },
    apiKey: { count: (...args: unknown[]) => apiKeyCountMock(...args) },
    receipt: { count: (...args: unknown[]) => receiptCountMock(...args) },
  },
}));

const operator = {
  id: "op_test_cuid",
  stripeCustomerId: "cus_test",
  email: "test@example.com",
  credits: 42,
  tier: "pro",
  stakeBalanceCents: 5000,
  accountStatus: "ACTIVE",
};

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  operatorFindUniqueMock.mockReset();
  apiKeyCountMock.mockReset();
  receiptCountMock.mockReset();
  authenticateApiKeyMock.mockResolvedValue(operator);
  operatorFindUniqueMock.mockResolvedValue(operator);
  apiKeyCountMock.mockResolvedValue(2);
  receiptCountMock.mockResolvedValue(15);
});

describe("GET /api/v1/operator/status", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/operator/status/route");
    const request = new Request("http://localhost/api/v1/operator/status");
    const response = await GET(request as never);
    expect(response.status).toBe(401);
  });

  it("returns operator status summary", async () => {
    const { GET } = await import("@/app/api/v1/operator/status/route");
    const request = new Request("http://localhost/api/v1/operator/status", {
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.credits).toBe(42);
    expect(body.tier).toBe("pro");
    expect(body.accountStatus).toBe("ACTIVE");
    expect(body.stakeBalanceCents).toBe(5000);
    expect(body.apiKeyCount).toBe(2);
    expect(body.receiptCount).toBe(15);
  });

  it("returns 404 when operator not found in db", async () => {
    operatorFindUniqueMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/operator/status/route");
    const request = new Request("http://localhost/api/v1/operator/status", {
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await GET(request as never);
    expect(response.status).toBe(404);
  });
});