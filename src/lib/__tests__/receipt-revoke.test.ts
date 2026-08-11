import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKeyMock = vi.fn();
const receiptFindUniqueMock = vi.fn();
const receiptUpdateMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    receipt: {
      findUnique: (...args: unknown[]) => receiptFindUniqueMock(...args),
      update: (...args: unknown[]) => receiptUpdateMock(...args),
    },
  },
}));

const operator = { id: "op_test_cuid", stripeCustomerId: "cus_test" };

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  receiptFindUniqueMock.mockReset();
  receiptUpdateMock.mockReset();
  authenticateApiKeyMock.mockResolvedValue(operator);
});

describe("POST /api/v1/receipts/:id/revoke", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/receipts/[id]/revoke/route");
    const request = new Request("http://localhost/api/v1/receipts/rcpt_1/revoke", {
      method: "POST",
    });
    const response = await POST(request as never, {
      params: Promise.resolve({ id: "rcpt_1" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for nonexistent receipt", async () => {
    receiptFindUniqueMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/receipts/[id]/revoke/route");
    const request = new Request("http://localhost/api/v1/receipts/missing/revoke", {
      method: "POST",
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await POST(request as never, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 409 when receipt is already revoked", async () => {
    receiptFindUniqueMock.mockResolvedValue({
      id: "r1",
      receiptId: "rcpt_1",
      operatorId: "op_test_cuid",
      revocationStatus: "revoked",
    });
    const { POST } = await import("@/app/api/v1/receipts/[id]/revoke/route");
    const request = new Request("http://localhost/api/v1/receipts/rcpt_1/revoke", {
      method: "POST",
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await POST(request as never, {
      params: Promise.resolve({ id: "rcpt_1" }),
    });
    expect(response.status).toBe(409);
  });

  it("revokes a receipt", async () => {
    receiptFindUniqueMock.mockResolvedValue({
      id: "r1",
      receiptId: "rcpt_1",
      operatorId: "op_test_cuid",
      revocationStatus: "active",
    });
    receiptUpdateMock.mockResolvedValue({
      id: "r1",
      receiptId: "rcpt_1",
      revocationStatus: "revoked",
    });
    const { POST } = await import("@/app/api/v1/receipts/[id]/revoke/route");
    const request = new Request("http://localhost/api/v1/receipts/rcpt_1/revoke", {
      method: "POST",
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await POST(request as never, {
      params: Promise.resolve({ id: "rcpt_1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revocationStatus).toBe("revoked");
    expect(receiptUpdateMock).toHaveBeenCalledWith({
      where: { receiptId: "rcpt_1" },
      data: { revocationStatus: "revoked" },
    });
  });

  it("cannot revoke another operator's receipt", async () => {
    receiptFindUniqueMock.mockResolvedValue({
      id: "r2",
      receiptId: "rcpt_other",
      operatorId: "op_other_cuid",
      revocationStatus: "active",
    });
    const { POST } = await import("@/app/api/v1/receipts/[id]/revoke/route");
    const request = new Request("http://localhost/api/v1/receipts/rcpt_other/revoke", {
      method: "POST",
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await POST(request as never, {
      params: Promise.resolve({ id: "rcpt_other" }),
    });
    expect(response.status).toBe(404);
  });
});