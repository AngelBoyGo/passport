import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AccessTier, AngelCoinCreditState, AngelCoinEntryType } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    angelCoinAccount: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { loadAccountWithJournal } from "@/lib/angelcoin/ledger-service";

// Keep the real ledger-service but stub DB access via prisma mock above;
// loadAccountWithJournal is the real function using prisma.angelCoinAccount.findUnique.

describe("GET /api/v1/passport/agents/:id/governance", () => {
  const commitment = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns the composed wallet, live status, access tier, and journal", async () => {
    prismaMock.angelCoinAccount.findUnique.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: commitment,
      creditState: AngelCoinCreditState.ACTIVE,
      accessTier: AccessTier.FULL,
      adminOverrideTier: null,
      backingMetadata: null,
      ownerOperatorId: "op_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      journal: [
        { id: "j1", accountId: "acct_1", entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100, counterpartyCommitment: null, metadata: null, createdAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: "j2", accountId: "acct_1", entryType: AngelCoinEntryType.SPEND, amount: 25, counterpartyCommitment: null, metadata: null, createdAt: new Date("2026-02-01T00:00:00.000Z") },
      ],
    });

    const { GET } = await import("@/app/api/v1/passport/agents/[id]/governance/route");
    const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/agents/${commitment}/governance`);
    const res = await GET(req, { params: Promise.resolve({ id: commitment }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject_commitment).toBe(commitment);
    expect(body.wallet.credits).toBe(75); // 100 - 25
    expect(body.wallet.granted).toBe(100);
    expect(body.wallet.spent).toBe(25);
    expect(body.access_tier).toBe("FULL");
    expect(body.live_status).toBeDefined();
    expect(body.recent_journal.length).toBe(2);
    expect(body.recent_journal[0].entry_type).toBe("SPEND"); // newest first
  });

  it("returns 400 for an invalid commitment", async () => {
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/governance/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/passport/agents/bad/governance");
    const res = await GET(req, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when there is no account/journal", async () => {
    prismaMock.angelCoinAccount.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/governance/route");
    const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/agents/${commitment}/governance`);
    const res = await GET(req, { params: Promise.resolve({ id: commitment }) });
    expect(res.status).toBe(404);
  });
});