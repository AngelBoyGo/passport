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

beforeEach(() => {
  vi.resetModules();
  resolveOperatorByPublicIdMock.mockReset();
  verifyGatePassMock.mockReset();
});

describe("POST /api/v1/gate/verify operator_id resolution", () => {
  it("resolves public op_cus_ id to DB operator before verifyGatePass", async () => {
    resolveOperatorByPublicIdMock.mockResolvedValue({
      id: "db_op_resolved",
      stripeCustomerId: "cus_ABC123",
    });
    verifyGatePassMock.mockResolvedValue({ allow_invocation: true });

    const { POST } = await import("@/app/api/v1/gate/verify/route");
    const request = new Request("http://localhost/api/v1/gate/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: "op_cus_ABC123",
        domain: OperationalDomain.FINANCIAL_CLEARING,
      }),
    });

    const response = await POST(request as import("next/server").NextRequest, {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ allow_invocation: true });
    expect(resolveOperatorByPublicIdMock).toHaveBeenCalledWith("op_cus_ABC123");
    expect(verifyGatePassMock).toHaveBeenCalledWith(
      "db_op_resolved",
      OperationalDomain.FINANCIAL_CLEARING
    );
  });

  it("returns 404 when public operator_id cannot be resolved", async () => {
    resolveOperatorByPublicIdMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/v1/gate/verify/route");
    const request = new Request("http://localhost/api/v1/gate/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: "op_cus_unknown",
        domain: OperationalDomain.CODE_GENERATION,
      }),
    });

    const response = await POST(request as import("next/server").NextRequest, {});
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Operator not found" });
    expect(verifyGatePassMock).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed operator_id without DB lookup", async () => {
    const { POST } = await import("@/app/api/v1/gate/verify/route");
    const request = new Request("http://localhost/api/v1/gate/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: "db_operator_cuid_not_public",
        domain: OperationalDomain.CUSTOMER_SUPPORT,
      }),
    });

    const response = await POST(request as import("next/server").NextRequest, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/operator_id/i);
    expect(resolveOperatorByPublicIdMock).not.toHaveBeenCalled();
    expect(verifyGatePassMock).not.toHaveBeenCalled();
  });
});
