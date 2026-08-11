import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKeyMock = vi.fn();
const slashingFindManyMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    slashingLedger: {
      findMany: (...args: unknown[]) => slashingFindManyMock(...args),
    },
  },
}));

const operator = { id: "op_test_cuid", stripeCustomerId: "cus_test" };

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  slashingFindManyMock.mockReset();
  authenticateApiKeyMock.mockResolvedValue(operator);
});

describe("GET /api/v1/operator/slashing-ledger", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/operator/slashing-ledger/route");
    const request = new Request("http://localhost/api/v1/operator/slashing-ledger");
    const response = await GET(request as never);
    expect(response.status).toBe(401);
  });

  it("returns slashing ledger entries", async () => {
    const entries = [
      {
        id: "s1",
        operatorId: "op_test_cuid",
        receiptId: "rcpt_1",
        penaltyCents: 2500,
        tranche: "DATA_LEAKAGE",
        timestamp: new Date("2026-07-20"),
      },
    ];
    slashingFindManyMock.mockResolvedValue(entries);
    const { GET } = await import("@/app/api/v1/operator/slashing-ledger/route");
    const request = new Request("http://localhost/api/v1/operator/slashing-ledger", {
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].penaltyCents).toBe(2500);
  });

  it("accepts tranche filter query param", async () => {
    slashingFindManyMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/operator/slashing-ledger/route");
    const request = new Request(
      "http://localhost/api/v1/operator/slashing-ledger?tranche=DATA_LEAKAGE",
      { headers: { Authorization: "Bearer pp_test" } }
    );
    await GET(request as never);
    expect(slashingFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tranche: "DATA_LEAKAGE",
        }),
      })
    );
  });
});