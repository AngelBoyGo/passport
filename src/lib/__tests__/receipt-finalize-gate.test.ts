import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperationalDomain } from "@prisma/client";

const authenticateApiKeyMock = vi.fn();
const verifyGatePassMock = vi.fn();
const finalizeReceiptMock = vi.fn();
const receiptFindFirstMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/gate/verifyGatePass", () => ({
  verifyGatePass: (...args: unknown[]) => verifyGatePassMock(...args),
}));

vi.mock("@/lib/receipt-service", () => ({
  finalizeReceipt: (...args: unknown[]) => finalizeReceiptMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    receipt: {
      findFirst: (...args: unknown[]) => receiptFindFirstMock(...args),
    },
  },
}));

const operator = {
  id: "db_operator_cuid",
  stripeCustomerId: "cus_finalize_gate",
};

const finalizeBody = {
  status: "success",
  output_hash: "abc123outputhash",
};

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  verifyGatePassMock.mockReset();
  finalizeReceiptMock.mockReset();
  receiptFindFirstMock.mockReset();

  authenticateApiKeyMock.mockResolvedValue(operator);
  receiptFindFirstMock.mockResolvedValue({
    domain: OperationalDomain.FINANCIAL_CLEARING,
  });
  verifyGatePassMock.mockResolvedValue({ allow_invocation: true });
  finalizeReceiptMock.mockResolvedValue({
    signed: { receipt_id: "rcpt_finalize_ok", status: "success" },
  });
});

describe("POST /api/v1/receipts/:id/finalize gate enforcement", () => {
  it("blocks finalize when verifyGatePass rejects operator", async () => {
    verifyGatePassMock.mockResolvedValue({
      allow_invocation: false,
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
    });

    const { POST } = await import(
      "@/app/api/v1/receipts/[id]/finalize/route"
    );
    const request = new Request(
      "http://localhost/api/v1/receipts/rcpt_pending/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_test_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalizeBody),
      }
    );

    const response = await POST(request as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "rcpt_pending" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Gate denied",
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
    });
    expect(receiptFindFirstMock).toHaveBeenCalledWith({
      where: { receiptId: "rcpt_pending", operatorId: "db_operator_cuid" },
      select: { domain: true },
    });
    expect(verifyGatePassMock).toHaveBeenCalledWith(
      "db_operator_cuid",
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(finalizeReceiptMock).not.toHaveBeenCalled();
  });

  it("finalizes receipt when verifyGatePass allows operator", async () => {
    const { POST } = await import(
      "@/app/api/v1/receipts/[id]/finalize/route"
    );
    const request = new Request(
      "http://localhost/api/v1/receipts/rcpt_pending/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_test_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalizeBody),
      }
    );

    const response = await POST(request as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "rcpt_pending" }),
    });

    expect(response.status).toBe(200);
    expect(verifyGatePassMock).toHaveBeenCalledWith(
      "db_operator_cuid",
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(finalizeReceiptMock).toHaveBeenCalledOnce();
  });

  it("uses SYSTEM_INTEGRATION when receipt domain is null", async () => {
    receiptFindFirstMock.mockResolvedValue({ domain: null });

    const { POST } = await import(
      "@/app/api/v1/receipts/[id]/finalize/route"
    );
    const request = new Request(
      "http://localhost/api/v1/receipts/rcpt_no_domain/finalize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_test_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalizeBody),
      }
    );

    await POST(request as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "rcpt_no_domain" }),
    });

    expect(verifyGatePassMock).toHaveBeenCalledWith(
      "db_operator_cuid",
      OperationalDomain.SYSTEM_INTEGRATION
    );
  });
});
