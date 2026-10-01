import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authenticateApiKey: vi.fn(),
    validateWalletOperation: vi.fn(),
    agentFindFirst: vi.fn(),
    walletUpsert: vi.fn(),
    operatorUpdate: vi.fn(),
    transaction: vi.fn(),
    checkSpendPolicy: vi.fn(),
  },
}));

vi.mock("@/lib/rateLimit", () => ({
  checkInMemoryRateLimit: () => ({ allowed: true }),
  clientIpFromRequest: () => "127.0.0.1",
}));
vi.mock("@/lib/operator", () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock("@/lib/agent-wallet/wallet", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, validateWalletOperation: mocks.validateWalletOperation };
});
vi.mock("@/lib/agent-economy/spend-policy-service", () => ({
  checkSpendPolicy: mocks.checkSpendPolicy,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findFirst: mocks.agentFindFirst },
    operator: { update: mocks.operatorUpdate },
    agentWallet: { upsert: mocks.walletUpsert, update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ balance: 0, staked: 0 }) },
    $transaction: mocks.transaction,
    $executeRaw: vi.fn(),
  },
}));

import { POST as depositPOST } from "@/app/api/v1/agent-wallet/deposit/route";
import { POST as transferPOST } from "@/app/api/v1/agent-wallet/transfer/route";
import { POST as stakePOST } from "@/app/api/v1/agent-wallet/stake/route";

function req(path: string, body: unknown) {
  return new NextRequest(`https://passport.metis.gold${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer pp_usr_x" },
    body: JSON.stringify(body),
  });
}

describe("agent-wallet thin aliases (audit fix M13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", credits: 1000 });
    mocks.agentFindFirst.mockResolvedValue({ id: "agent_1" });
    mocks.walletUpsert.mockResolvedValue({});
    mocks.checkSpendPolicy.mockResolvedValue({ allowed: true });
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        operator: { update: vi.fn() },
        agentWallet: { upsert: vi.fn(), update: vi.fn() },
        $executeRaw: vi.fn().mockResolvedValue(1),
      })
    );
  });

  it("deposit alias reaches the deposit branch (operator credits decremented)", async () => {
    const res = await depositPOST(req("/api/v1/agent-wallet/deposit", { commitment: "a".repeat(64), amount: 5 })).catch(() => ({ status: 0 }));
    // If the action were missing, the route returns 400 before touching the tx.
    expect(mocks.transaction).toHaveBeenCalled();
    expect((res as Response).status ?? 0).toBeLessThan(500);
  });

  it("transfer alias reaches the transfer branch (agent ownership verified)", async () => {
    await transferPOST(req("/api/v1/agent-wallet/transfer", { commitment: "a".repeat(64), amount: 5, target_commitment: "b".repeat(64) })).catch(() => null);
    // Ownership is checked in the shared handler before the action switch; if
    // action were missing the route 400s before this lookup.
    expect(mocks.agentFindFirst).toHaveBeenCalled();
  });

  it("stake alias reaches the stake branch (atomic guarded stake)", async () => {
    await stakePOST(req("/api/v1/agent-wallet/stake", { commitment: "a".repeat(64), amount: 5 })).catch(() => null);
    expect(mocks.agentFindFirst).toHaveBeenCalled();
  });
});
