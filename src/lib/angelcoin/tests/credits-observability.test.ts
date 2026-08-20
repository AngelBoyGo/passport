import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const logPassportEventMock = vi.fn();

vi.mock("@/lib/observability/logger", () => ({
  logPassportEvent: (...args: unknown[]) => logPassportEventMock(...args),
}));

const getAccountBalancesMock = vi.fn();
vi.mock("@/lib/angelcoin/ledger-service", () => ({
  getAccountBalances: (...args: unknown[]) => getAccountBalancesMock(...args),
}));

describe("GET /api/v1/passport/agents/:id/credits (Observability wiring)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    logPassportEventMock.mockReset();
    getAccountBalancesMock.mockReset();
  });

  it("emits credits_read observability log event with request_id and latency", async () => {
    const validId = "f".repeat(64);
    getAccountBalancesMock.mockResolvedValue({
      account: {
        subjectCommitment: validId,
        creditState: "ACTIVE",
        accessTier: "FULL",
      },
      balances: { availableBalance: 100 },
    });

    const { GET } = await import("@/app/api/v1/passport/agents/[id]/credits/route");
    const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/agents/${validId}/credits`);
    const res = await GET(req, { params: Promise.resolve({ id: validId }) });

    expect(res.status).toBe(200);
    expect(logPassportEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "credits_read",
        outcome: "issued",
        http_status: 200,
        request_id: expect.any(String),
        latency_ms: expect.any(Number),
      })
    );
  });
});
