import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AccessTier,
  AngelCoinCreditState,
} from "@prisma/client";

const VALID_ID = "a".repeat(64);

const loadAccountWithJournalMock = vi.fn();
const prismaUpdateMock = vi.fn();

vi.mock("@/lib/angelcoin/ledger-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/angelcoin/ledger-service")>();
  return {
    ...actual,
    loadAccountWithJournal: (...args: unknown[]) =>
      loadAccountWithJournalMock(...args),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    angelCoinAccount: {
      update: (...args: unknown[]) => prismaUpdateMock(...args),
    },
  },
}));

function makeStaleAccount() {
  return {
    id: "acct_stale",
    subjectCommitment: VALID_ID,
    creditState: AngelCoinCreditState.ACTIVE,
    accessTier: AccessTier.FULL,
    adminOverrideTier: null,
    backingMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    journal: [],
  };
}

beforeEach(async () => {
  vi.resetModules();
  loadAccountWithJournalMock.mockReset();
  prismaUpdateMock.mockReset();
  const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
  resetInMemoryRateLimits();
});

describe("passport-live tier freshness routes", () => {
  it("passport-live accessTier matches access-tier evaluation for same account", async () => {
    loadAccountWithJournalMock.mockResolvedValue(makeStaleAccount());

    const { GET: getLive } =
      await import("@/app/api/v1/passport/agents/[id]/passport-live/route");
    const { GET: getTier } =
      await import("@/app/api/v1/passport/agents/[id]/access-tier/route");

    const liveResponse = await getLive(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_ID}/passport-live`
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );
    const tierResponse = await getTier(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_ID}/access-tier`
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );

    expect(liveResponse.status).toBe(200);
    expect(tierResponse.status).toBe(200);

    const liveBody = await liveResponse.json();
    const tierBody = await tierResponse.json();

    expect(liveBody.accessTier).toBe(tierBody.tier);
    expect(liveBody.accessTier).toBe(AccessTier.SHELTERED);
    expect(liveBody.storedAccessTier).toBe(AccessTier.FULL);
  });

  it("GET passport-live performs no DB write", async () => {
    loadAccountWithJournalMock.mockResolvedValue(makeStaleAccount());

    const { GET } =
      await import("@/app/api/v1/passport/agents/[id]/passport-live/route");
    await GET(
      new Request(
        `http://localhost/api/v1/passport/agents/${VALID_ID}/passport-live`
      ) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );

    expect(prismaUpdateMock).not.toHaveBeenCalled();
  });
});
