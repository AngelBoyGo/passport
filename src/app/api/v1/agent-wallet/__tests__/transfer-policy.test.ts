import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authenticateApiKey: vi.fn(),
    checkSpendPolicy: vi.fn(),
    agentFindFirst: vi.fn(),
    walletFindUnique: vi.fn(),
    walletUpdate: vi.fn(),
    walletUpsert: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/lib/rateLimit", () => ({
  checkInMemoryRateLimit: () => ({ allowed: true }),
  clientIpFromRequest: () => "127.0.0.1",
}));
vi.mock("@/lib/operator", () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock("@/lib/agent-economy/spend-policy-service", () => ({
  checkSpendPolicy: mocks.checkSpendPolicy,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findFirst: mocks.agentFindFirst },
    agentWallet: {
      findUnique: mocks.walletFindUnique,
      update: mocks.walletUpdate,
      upsert: mocks.walletUpsert,
    },
    $transaction: mocks.transaction,
  },
}));

const SENDER = "a".repeat(64);
const TARGET = "b".repeat(64);

function req(body: unknown) {
  return new NextRequest("https://passport.metis.gold/api/v1/agent-wallet", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", authorization: "Bearer pp_usr_x" },
  });
}

describe("agent-wallet transfer spend policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", credits: 1000 });
    mocks.agentFindFirst.mockResolvedValue({ id: "agent_1" });
    mocks.walletFindUnique.mockResolvedValue({
      balance: 500,
      staked: 0,
      earnedTotal: 0,
      spentTotal: 0,
      lastActivityAt: new Date(),
      createdAt: new Date(),
    });
    mocks.walletUpdate.mockResolvedValue({});
    mocks.walletUpsert.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ agentWallet: { update: vi.fn(), upsert: vi.fn() } })
    );
  });

  it("denies a transfer over the agent's spend policy (403, no ledger write)", async () => {
    mocks.checkSpendPolicy.mockResolvedValue({ allowed: false, reason: "exceeds daily cap" });
    const { POST } = await import("@/app/api/v1/agent-wallet/route");
    const res = await POST(req({ action: "transfer", commitment: SENDER, amount: 100, target_commitment: TARGET }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe("spend_policy_denied");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.checkSpendPolicy).toHaveBeenCalledWith({
      agentCommitment: SENDER,
      amount: 100,
      counterparty: TARGET,
    });
  });

  it("allows a transfer within policy", async () => {
    mocks.checkSpendPolicy.mockResolvedValue({ allowed: true });
    const { POST } = await import("@/app/api/v1/agent-wallet/route");
    const res = await POST(req({ action: "transfer", commitment: SENDER, amount: 100, target_commitment: TARGET }));
    expect(res.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalled();
  });
});
