import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authenticateApiKeyMock = vi.hoisted(() => vi.fn());
const requestWithdrawalMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKeyMock(...a),
}));
vi.mock("@/lib/bridge/withdraw", () => ({
  requestWithdrawal: (...a: unknown[]) => requestWithdrawalMock(...a),
}));

describe("POST /api/v1/agent-pay/withdraw — E-bank", () => {
  const commitment = "c".repeat(64);
  const operator = { id: "op_1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a valid key", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/agent-pay/withdraw/route");
    const res = await POST(new NextRequest("http://localhost/api/v1/agent-pay/withdraw", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid commitment", async () => {
    authenticateApiKeyMock.mockResolvedValue(operator);
    const { POST } = await import("@/app/api/v1/agent-pay/withdraw/route");
    const req = new NextRequest("http://localhost/api/v1/agent-pay/withdraw", {
      method: "POST",
      body: JSON.stringify({ subject_commitment: "bad", reference: "wd_x", amount: 100 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller is not the wallet owner", async () => {
    authenticateApiKeyMock.mockResolvedValue(operator);
    requestWithdrawalMock.mockRejectedValue(new Error("Withdrawal requires an owned custodial wallet binding"));

    const { POST } = await import("@/app/api/v1/agent-pay/withdraw/route");
    const req = new NextRequest("http://localhost/api/v1/agent-pay/withdraw", {
      method: "POST",
      body: JSON.stringify({ subject_commitment: commitment, reference: "wd_1", amount: 500 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 201 with a proof-of-payout receipt on success", async () => {
    authenticateApiKeyMock.mockResolvedValue(operator);
    requestWithdrawalMock.mockResolvedValue({ applied: true, receipt_id: "rcpt_proof", reference: "wd_2" });

    const { POST } = await import("@/app/api/v1/agent-pay/withdraw/route");
    const req = new NextRequest("http://localhost/api/v1/agent-pay/withdraw", {
      method: "POST",
      body: JSON.stringify({ subject_commitment: commitment, reference: "wd_2", amount: 500 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toBe(true);
    expect(body.receipt_id).toBe("rcpt_proof");
  });

  it("returns 409 for a duplicate reference", async () => {
    authenticateApiKeyMock.mockResolvedValue(operator);
    requestWithdrawalMock.mockResolvedValue({ applied: false, reason: "Duplicate burn/payout" });

    const { POST } = await import("@/app/api/v1/agent-pay/withdraw/route");
    const req = new NextRequest("http://localhost/api/v1/agent-pay/withdraw", {
      method: "POST",
      body: JSON.stringify({ subject_commitment: commitment, reference: "wd_dup", amount: 100 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.applied).toBe(false);
  });
});