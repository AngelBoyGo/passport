import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sessionFromRequestMock = vi.fn();
const bridgeWalletFindUniqueMock = vi.fn();
const bridgeWalletUpsertMock = vi.fn();
const operatorUpdateMock = vi.fn();
const operatorFindUniqueMock = vi.fn();
const adminAuditLogCreateMock = vi.fn();

vi.mock("@/lib/auth/cookies", () => ({
  sessionFromRequest: (...args: unknown[]) => sessionFromRequestMock(...args),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    bridgeWallet: { findUnique: bridgeWalletFindUniqueMock, upsert: bridgeWalletUpsertMock },
    operator: {
      update: operatorUpdateMock,
      findUnique: operatorFindUniqueMock,
    },
    adminAuditLog: { create: adminAuditLogCreateMock },
  },
}));

function makeOp(email = "ops@example.com") {
  return { id: "op_1", email, kycStatus: "PENDING" };
}

describe("Operator wallet + KYC routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.ADMIN_OPERATOR_EMAILS;
    delete process.env.BRIDGE_ENV;
  });

  it("GET /api/v1/account/wallet returns the operator wallet and creates on first touch", async () => {
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp() });
    bridgeWalletFindUniqueMock.mockResolvedValue(null);
    bridgeWalletUpsertMock.mockResolvedValue({
      id: "bw_1",
      operatorId: "op_1",
      chainAddress: "0xabc",
      upstream: "bridge",
      subjectCommitment: null,
      bridgeExternalId: null,
    });

    const { GET } = await import("@/app/api/v1/account/wallet/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/account/wallet"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operator_id).toBe("op_1");
    expect(body.upstream).toBe("bridge");
    expect(bridgeWalletUpsertMock).toHaveBeenCalled();
  });

  it("GET /api/v1/account/wallet is idempotent when a wallet exists", async () => {
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp() });
    bridgeWalletFindUniqueMock.mockResolvedValue({
      id: "bw_1",
      operatorId: "op_1",
      chainAddress: "0xabc",
      upstream: "bridge",
      subjectCommitment: null,
      bridgeExternalId: null,
    });

    const { GET } = await import("@/app/api/v1/account/wallet/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/account/wallet"));
    const body = await res.json();
    expect(body.chain_address).toBe("0xabc");
    expect(bridgeWalletUpsertMock).not.toHaveBeenCalled();
  });

  it("POST /api/v1/admin/operator/kyc rejects a non-admin approving KYC", async () => {
    process.env.ADMIN_OPERATOR_EMAILS = "ceo@example.com";
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp("regular@example.com") });

    const { POST } = await import("@/app/api/v1/admin/operator/kyc/route");
    const req = new NextRequest("http://localhost/api/v1/admin/operator/kyc", {
      method: "POST",
      body: JSON.stringify({ operatorId: "op_2", status: "APPROVED" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("POST /api/v1/admin/operator/kyc allows an executive admin to approve", async () => {
    process.env.ADMIN_OPERATOR_EMAILS = "ceo@example.com";
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp("ceo@example.com") });
    operatorFindUniqueMock.mockResolvedValue({ kycStatus: "PENDING" });
    operatorUpdateMock.mockResolvedValue({ id: "op_2", email: "b@x.com", kycStatus: "APPROVED" });
    adminAuditLogCreateMock.mockResolvedValue({});

    const { POST } = await import("@/app/api/v1/admin/operator/kyc/route");
    const req = new NextRequest("http://localhost/api/v1/admin/operator/kyc", {
      method: "POST",
      body: JSON.stringify({ operatorId: "op_2", status: "APPROVED" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kycStatus).toBe("APPROVED");
  });
});