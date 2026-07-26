import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperationalDomain } from "@prisma/client";

const authenticateApiKeyMock = vi.fn();
const verifyGatePassMock = vi.fn();
const issueReceiptMock = vi.fn();
const operatorIdFromStripeMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
  operatorIdFromStripe: (...args: unknown[]) => operatorIdFromStripeMock(...args),
}));

vi.mock("@/lib/gate/verifyGatePass", () => ({
  verifyGatePass: (...args: unknown[]) => verifyGatePassMock(...args),
}));

vi.mock("@/lib/receipt-service", () => ({
  issueReceipt: (...args: unknown[]) => issueReceiptMock(...args),
}));

const operator = {
  id: "db_operator_cuid",
  stripeCustomerId: "cus_gate_test",
};

const issueBody = {
  agent_id: "agent-1",
  receipt_type: "competence",
  input_digest: "abc123digest",
  authority_scope: "fulfillment.demo",
  expiry: "2026-12-31T00:00:00.000Z",
  domain: OperationalDomain.FINANCIAL_CLEARING,
};

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  verifyGatePassMock.mockReset();
  issueReceiptMock.mockReset();
  operatorIdFromStripeMock.mockReset();

  authenticateApiKeyMock.mockResolvedValue(operator);
  operatorIdFromStripeMock.mockReturnValue("op_cus_gate_test");
  verifyGatePassMock.mockResolvedValue({ allow_invocation: true });
  issueReceiptMock.mockResolvedValue({
    signed: { receipt_id: "rcpt_gate_ok", status: "pending" },
  });
});

describe("POST /api/v1/receipts gate enforcement", () => {
  it("blocks receipt issue when verifyGatePass rejects operator", async () => {
    verifyGatePassMock.mockResolvedValue({
      allow_invocation: false,
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
    });

    const { POST } = await import("@/app/api/v1/receipts/route");
    const request = new Request("http://localhost/api/v1/receipts", {
      method: "POST",
      headers: {
        Authorization: "Bearer pp_test_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(issueBody),
    });

    const response = await POST(request as import("next/server").NextRequest, {});
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Gate denied",
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
    });
    expect(verifyGatePassMock).toHaveBeenCalledWith(
      "db_operator_cuid",
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(issueReceiptMock).not.toHaveBeenCalled();
  });

  it("issues receipt when verifyGatePass allows operator", async () => {
    const { POST } = await import("@/app/api/v1/receipts/route");
    const request = new Request("http://localhost/api/v1/receipts", {
      method: "POST",
      headers: {
        Authorization: "Bearer pp_test_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(issueBody),
    });

    const response = await POST(request as import("next/server").NextRequest, {});

    expect(response.status).toBe(201);
    expect(verifyGatePassMock).toHaveBeenCalledWith(
      "db_operator_cuid",
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(issueReceiptMock).toHaveBeenCalledOnce();
  });
});
