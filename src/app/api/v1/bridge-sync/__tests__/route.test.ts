import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  account: { id: "acct_1", subjectCommitment: "a".repeat(64) },
  entries: [{ entryType: "OPERATOR_GRANT", amount: 100 }] as Array<{ entryType: string; amount: number }>,
  wallet: { balance: 0 } as { balance: number } | null,
  upsert: vi.fn(async () => ({ balance: 0 })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    angelCoinAccount: {
      findUnique: async () => h.account,
      create: async () => h.account,
    },
    angelCoinJournalEntry: { findMany: async () => h.entries, create: vi.fn() },
    agentWallet: {
      findUnique: async () => h.wallet,
      upsert: (...args: unknown[]) => h.upsert(...(args as [])),
    },
  },
}));
vi.mock("@/lib/operator", () => ({ authenticateApiKey: async () => null }));
vi.mock("@/lib/rateLimit", () => ({
  checkInMemoryRateLimit: () => ({ allowed: true }),
  clientIpFromRequest: () => "1.2.3.4",
}));

import { POST } from "@/app/api/v1/bridge-sync/route";

const COMMIT = "a".repeat(64);

function req(body: object) {
  return new NextRequest("http://localhost/api/v1/bridge-sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-scheduler-secret": "s" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.SCHEDULER_SECRET = "s";
  h.upsert.mockClear();
  h.wallet = { balance: 0 };
  h.entries = [{ entryType: "OPERATOR_GRANT", amount: 100 }];
});

afterEach(() => {
  delete process.env.SCHEDULER_SECRET;
});

describe("bridge-sync ledger_to_wallet", () => {
  it("refuses a POSITIVE delta (would mint unbacked ANGEL)", async () => {
    const res = await POST(req({ direction: "ledger_to_wallet", subject_commitment: COMMIT }));
    const json = await res.json();
    expect(json.synced).toBe(false);
    expect(String(json.reason)).toMatch(/Refused/);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("burns down a NEGATIVE delta (wallet ahead of ledger)", async () => {
    h.entries = [{ entryType: "OPERATOR_GRANT", amount: 40 }];
    h.wallet = { balance: 100 };
    const res = await POST(req({ direction: "ledger_to_wallet", subject_commitment: COMMIT }));
    const json = await res.json();
    expect(json.synced).toBe(true);
    expect(h.upsert).toHaveBeenCalled();
  });
});
