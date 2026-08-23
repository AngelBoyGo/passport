import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccessTier, AngelCoinEntryType } from "@prisma/client";

const authenticateApiKeyMock = vi.fn();
const grantCreditsMock = vi.fn();
const transferCreditsMock = vi.fn();
const assertCanTransferFromMock = vi.fn();
const getOrCreateAccountMock = vi.fn();
const applyAccessEvaluationMock = vi.fn();
const setAdminOverrideMock = vi.fn();
const getAccountBalancesMock = vi.fn();
const listJournalEntriesMock = vi.fn();
const getAccessTierEvaluationMock = vi.fn();
const loadAccountWithJournalMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/angelcoin/ledger-service", () => ({
  grantCredits: (...args: unknown[]) => grantCreditsMock(...args),
  transferCredits: (...args: unknown[]) => transferCreditsMock(...args),
  assertCanTransferFrom: (...args: unknown[]) => assertCanTransferFromMock(...args),
  getOrCreateAccount: (...args: unknown[]) => getOrCreateAccountMock(...args),
  getAccountBalances: (...args: unknown[]) => getAccountBalancesMock(...args),
  listJournalEntries: (...args: unknown[]) => listJournalEntriesMock(...args),
  loadAccountWithJournal: (...args: unknown[]) => loadAccountWithJournalMock(...args),
}));

vi.mock("@/lib/angelcoin/access-tiers", () => ({
  applyAccessEvaluation: (...args: unknown[]) => applyAccessEvaluationMock(...args),
  setAdminOverride: (...args: unknown[]) => setAdminOverrideMock(...args),
  getAccessTierEvaluation: (...args: unknown[]) => getAccessTierEvaluationMock(...args),
}));

vi.mock("@/lib/angelcoin/projections", () => ({
  buildPassportReadModel: vi.fn((account) => ({
    subjectCommitment: account.subjectCommitment,
    balances: { availableBalance: 100 },
    accessTier: AccessTier.FULL,
  })),
  buildLiveStatus: vi.fn((account) => ({
    subjectCommitment: account.subjectCommitment,
    availableBalance: 100,
    accessTier: AccessTier.FULL,
    statusLabel: "active",
  })),
}));

import {
  InsufficientAngelCoinFundsError,
  AngelCoinAccountNotFoundError,
  InvalidAgentCommitmentError,
} from "@/lib/angelcoin/errors";

const VALID_ID = "e".repeat(64);
const operator = { id: "op_admin", stripeCustomerId: "cus_admin" };

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  grantCreditsMock.mockReset();
  transferCreditsMock.mockReset();
  assertCanTransferFromMock.mockReset();
  getOrCreateAccountMock.mockReset();
  applyAccessEvaluationMock.mockReset();
  setAdminOverrideMock.mockReset();
  getAccountBalancesMock.mockReset();
  listJournalEntriesMock.mockReset();
  getAccessTierEvaluationMock.mockReset();
  loadAccountWithJournalMock.mockReset();

  authenticateApiKeyMock.mockResolvedValue(operator);
  assertCanTransferFromMock.mockResolvedValue(true);
  getOrCreateAccountMock.mockResolvedValue({ id: "acct_1", subjectCommitment: VALID_ID });
});

describe("POST /api/v1/passport/credits/grants", () => {
  it("returns 201 on happy path", async () => {
    grantCreditsMock.mockResolvedValue({
      account: { subjectCommitment: VALID_ID },
      entry: { id: "entry_1", amount: 50 },
      balances: { availableBalance: 50 },
    });

    const { POST } = await import("@/app/api/v1/passport/credits/grants/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/grants", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject_commitment: VALID_ID,
          amount: 50,
        }),
      }) as import("next/server").NextRequest
    );

    expect(response.status).toBe(201);
    expect(grantCreditsMock).toHaveBeenCalledWith(VALID_ID, 50, undefined);
  });

  it("returns 401 without auth", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/passport/credits/grants/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_commitment: VALID_ID, amount: 10 }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 on invalid payload", async () => {
    const { POST } = await import("@/app/api/v1/passport/credits/grants/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/grants", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject_commitment: "bad", amount: -1 }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/v1/passport/credits/transfers", () => {
  it("returns 200 on happy path", async () => {
    transferCreditsMock.mockResolvedValue({
      senderEntry: { id: "s1" },
      receiverEntry: { id: "r1" },
      balances: { availableBalance: 60 },
    });

    const { POST } = await import("@/app/api/v1/passport/credits/transfers/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/transfers", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from_commitment: VALID_ID,
          to_commitment: "f".repeat(64),
          amount: 10,
        }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(200);
  });

  it("returns 403 when the caller does NOT own the source commitment (H5)", async () => {
    assertCanTransferFromMock.mockResolvedValue(false);

    const { POST } = await import("@/app/api/v1/passport/credits/transfers/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/transfers", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from_commitment: VALID_ID,
          to_commitment: "f".repeat(64),
          amount: 10,
        }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(403);
    expect(transferCreditsMock).not.toHaveBeenCalled();
  });

  it("returns 402 on insufficient funds", async () => {
    transferCreditsMock.mockRejectedValue(new InsufficientAngelCoinFundsError());
    const { POST } = await import("@/app/api/v1/passport/credits/transfers/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/transfers", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from_commitment: VALID_ID,
          to_commitment: "f".repeat(64),
          amount: 999,
        }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(402);
  });

  it("returns 404 on unknown identity", async () => {
    transferCreditsMock.mockRejectedValue(new AngelCoinAccountNotFoundError());
    const { POST } = await import("@/app/api/v1/passport/credits/transfers/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/credits/transfers", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from_commitment: VALID_ID,
          to_commitment: "f".repeat(64),
          amount: 10,
        }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/v1/passport/access/evaluate", () => {
  it("returns 200 with evaluation", async () => {
    applyAccessEvaluationMock.mockResolvedValue({
      account: { subjectCommitment: VALID_ID, accessTier: AccessTier.LIMITED },
      evaluation: { tier: AccessTier.LIMITED, reason: "low_balance_limited" },
      balances: { availableBalance: 25 },
    });

    const { POST } = await import("@/app/api/v1/passport/access/evaluate/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/access/evaluate", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject_commitment: VALID_ID }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evaluation.tier).toBe(AccessTier.LIMITED);
  });
});

describe("POST /api/v1/passport/access/override", () => {
  it("returns 200 on override", async () => {
    setAdminOverrideMock.mockResolvedValue({
      account: {
        subjectCommitment: VALID_ID,
        accessTier: AccessTier.FULL,
        adminOverrideTier: AccessTier.FULL,
      },
      evaluation: { tier: AccessTier.FULL, reason: "admin_override" },
      balances: { availableBalance: 100 },
    });

    const { POST } = await import("@/app/api/v1/passport/access/override/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/access/override", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject_commitment: VALID_ID, tier: AccessTier.FULL }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 on invalid tier payload", async () => {
    const { POST } = await import("@/app/api/v1/passport/access/override/route");
    const response = await POST(
      new Request("http://localhost/api/v1/passport/access/override", {
        method: "POST",
        headers: {
          Authorization: "Bearer pp_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject_commitment: VALID_ID, tier: "INVALID" }),
      }) as import("next/server").NextRequest
    );
    expect(response.status).toBe(400);
  });
});

describe("GET read routes", () => {
  beforeEach(async () => {
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();
  });

  it("GET credits returns balances", async () => {
    getAccountBalancesMock.mockResolvedValue({
      account: { subjectCommitment: VALID_ID },
      balances: { availableBalance: 75, lockedBalance: 5 },
      entries: [],
    });

    const { GET } = await import("@/app/api/v1/passport/agents/[id]/credits/route");
    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_ID}/credits`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.balances.availableBalance).toBe(75);
  });

  it("GET credits returns 404 when account missing", async () => {
    getAccountBalancesMock.mockRejectedValue(new AngelCoinAccountNotFoundError());
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/credits/route");
    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_ID}/credits`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );
    expect(response.status).toBe(404);
  });

  it("GET credit-journal returns entries", async () => {
    listJournalEntriesMock.mockResolvedValue({
      account: { subjectCommitment: VALID_ID },
      entries: [
        { id: "j1", entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 10, createdAt: new Date() },
      ],
    });

    const { GET } = await import("@/app/api/v1/passport/agents/[id]/credit-journal/route");
    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_ID}/credit-journal?limit=10`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toHaveLength(1);
  });

  it("GET access-tier returns tier and reason", async () => {
    getAccessTierEvaluationMock.mockResolvedValue({
      account: { subjectCommitment: VALID_ID, adminOverrideTier: null, accessTier: AccessTier.SANDBOXED },
      evaluation: { tier: AccessTier.SANDBOXED, reason: "low_balance_sandbox" },
      balances: { availableBalance: 5 },
    });

    const { GET } = await import("@/app/api/v1/passport/agents/[id]/access-tier/route");
    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_ID}/access-tier`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier).toBe(AccessTier.SANDBOXED);
  });

  it("GET passport-live returns live status", async () => {
    loadAccountWithJournalMock.mockResolvedValue({
      subjectCommitment: VALID_ID,
      journal: [],
      creditState: "ACTIVE",
      accessTier: AccessTier.FULL,
      adminOverrideTier: null,
      updatedAt: new Date(),
    });

    const { GET } = await import("@/app/api/v1/passport/agents/[id]/passport-live/route");
    const response = await GET(
      new Request(`http://localhost/api/v1/passport/agents/${VALID_ID}/passport-live`) as import("next/server").NextRequest,
      { params: Promise.resolve({ id: VALID_ID }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subjectCommitment).toBe(VALID_ID);
    expect(body.statusLabel).toBe("active");
  });

  it("GET routes return 400 for invalid id", async () => {
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/credits/route");
    const response = await GET(
      new Request("http://localhost/api/v1/passport/agents/not-valid/credits") as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "not-valid" }) }
    );
    expect(response.status).toBe(400);
  });
});

describe("angelcoinSchemas", () => {
  it("validates grant body", async () => {
    const { grantCreditsBodySchema } = await import("@/lib/validation/angelcoinSchemas");
    const result = grantCreditsBodySchema.safeParse({
      subject_commitment: VALID_ID,
      amount: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid transfer body", async () => {
    const { transferCreditsBodySchema } = await import("@/lib/validation/angelcoinSchemas");
    const result = transferCreditsBodySchema.safeParse({
      from_commitment: "bad",
      to_commitment: VALID_ID,
      amount: 0,
    });
    expect(result.success).toBe(false);
  });
});
