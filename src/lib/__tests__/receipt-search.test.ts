import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKeyMock = vi.fn();
const receiptFindManyMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    receipt: { findMany: (...args: unknown[]) => receiptFindManyMock(...args) },
  },
}));

const operator = { id: "op_test_cuid", stripeCustomerId: "cus_test" };

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  receiptFindManyMock.mockReset();
  authenticateApiKeyMock.mockResolvedValue(operator);
});

describe("GET /api/v1/receipts", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/receipts/route");
    const request = new Request("http://localhost/api/v1/receipts");
    const response = await GET(request as never);
    expect(response.status).toBe(401);
  });

  it("returns receipts with default pagination", async () => {
    receiptFindManyMock.mockResolvedValue([{ id: "r1", receiptId: "rcpt_1" }]);
    const { GET } = await import("@/app/api/v1/receipts/route");
    const request = new Request("http://localhost/api/v1/receipts", {
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    expect(receiptFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operatorId: "op_test_cuid" },
        take: 50,
        orderBy: { issuedAt: "desc" },
      })
    );
  });

  it("filters by domain", async () => {
    receiptFindManyMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/receipts/route");
    const request = new Request(
      "http://localhost/api/v1/receipts?domain=FINANCIAL_CLEARING",
      { headers: { Authorization: "Bearer pp_test" } }
    );
    await GET(request as never);
    expect(receiptFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domain: "FINANCIAL_CLEARING" }),
      })
    );
  });

  it("filters by status", async () => {
    receiptFindManyMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/receipts/route");
    const request = new Request(
      "http://localhost/api/v1/receipts?status=success",
      { headers: { Authorization: "Bearer pp_test" } }
    );
    await GET(request as never);
    expect(receiptFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "success" }),
      })
    );
  });

  it("filters by date range", async () => {
    receiptFindManyMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/receipts/route");
    const request = new Request(
      "http://localhost/api/v1/receipts?from=2026-01-01&to=2026-06-30",
      { headers: { Authorization: "Bearer pp_test" } }
    );
    await GET(request as never);
    const call = receiptFindManyMock.mock.calls[0][0];
    expect(call.where.issuedAt).toBeDefined();
    expect(call.where.issuedAt.gte).toBeDefined();
    expect(call.where.issuedAt.lte).toBeDefined();
  });

  it("enforces max limit of 100", async () => {
    receiptFindManyMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/receipts/route");
    const request = new Request(
      "http://localhost/api/v1/receipts?limit=999",
      { headers: { Authorization: "Bearer pp_test" } }
    );
    await GET(request as never);
    expect(receiptFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });
});