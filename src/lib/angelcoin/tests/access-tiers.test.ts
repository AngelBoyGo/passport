import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AccessTier,
  AngelCoinCreditState,
} from "@prisma/client";
import {
  evaluateAccessTier,
  LIMITED_THRESHOLD,
  SANDBOX_THRESHOLD,
  applyAccessEvaluation,
  setAdminOverride,
} from "@/lib/angelcoin/access-tiers";

const VALID_COMMITMENT = "c".repeat(64);

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    angelCoinAccount: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

vi.mock("@/lib/angelcoin/ledger-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/angelcoin/ledger-service")>();
  return {
    ...actual,
    loadAccountWithJournal: vi.fn(),
    getAccountBalances: vi.fn(),
  };
});

import { loadAccountWithJournal } from "@/lib/angelcoin/ledger-service";

const loadAccountWithJournalMock = vi.mocked(loadAccountWithJournal);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evaluateAccessTier", () => {
  it("returns admin override tier when set", () => {
    const result = evaluateAccessTier({
      availableBalance: 0,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.INACTIVE,
      adminOverrideTier: AccessTier.FULL,
    });
    expect(result).toEqual({ tier: AccessTier.FULL, reason: "admin_override" });
  });

  it("returns SUSPENDED when creditState is INACTIVE", () => {
    const result = evaluateAccessTier({
      availableBalance: 100,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.INACTIVE,
      adminOverrideTier: null,
    });
    expect(result).toEqual({ tier: AccessTier.SUSPENDED, reason: "credit_inactive" });
  });

  it("returns SHELTERED when available balance is zero or negative", () => {
    expect(
      evaluateAccessTier({
        availableBalance: 0,
        lockedBalance: 0,
        creditState: AngelCoinCreditState.ACTIVE,
        adminOverrideTier: null,
      })
    ).toEqual({ tier: AccessTier.SHELTERED, reason: "safety_net_floor" });

    expect(
      evaluateAccessTier({
        availableBalance: -5,
        lockedBalance: 0,
        creditState: AngelCoinCreditState.ACTIVE,
        adminOverrideTier: null,
      })
    ).toEqual({ tier: AccessTier.SHELTERED, reason: "safety_net_floor" });
  });

  it("returns SANDBOXED below sandbox threshold", () => {
    const result = evaluateAccessTier({
      availableBalance: SANDBOX_THRESHOLD - 1,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(result).toEqual({ tier: AccessTier.SANDBOXED, reason: "low_balance_sandbox" });
  });

  it("returns LIMITED below limited threshold but at or above sandbox", () => {
    const result = evaluateAccessTier({
      availableBalance: LIMITED_THRESHOLD - 1,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(result).toEqual({ tier: AccessTier.LIMITED, reason: "low_balance_limited" });
  });

  it("returns FULL at or above limited threshold", () => {
    const result = evaluateAccessTier({
      availableBalance: LIMITED_THRESHOLD,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(result).toEqual({ tier: AccessTier.FULL, reason: "sufficient_balance" });
  });

  it("downgrades on spend crossing threshold boundaries", () => {
    const before = evaluateAccessTier({
      availableBalance: LIMITED_THRESHOLD,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(before.tier).toBe(AccessTier.FULL);

    const after = evaluateAccessTier({
      availableBalance: SANDBOX_THRESHOLD - 1,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(after.tier).toBe(AccessTier.SANDBOXED);
  });

  it("upgrades after recovery topup crosses threshold", () => {
    const sheltered = evaluateAccessTier({
      availableBalance: 0,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(sheltered.tier).toBe(AccessTier.SHELTERED);

    const recovered = evaluateAccessTier({
      availableBalance: LIMITED_THRESHOLD,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(recovered.tier).toBe(AccessTier.FULL);
  });
});

describe("applyAccessEvaluation", () => {
  it("persists recomputed access tier on account", async () => {
    loadAccountWithJournalMock.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: VALID_COMMITMENT,
      creditState: AngelCoinCreditState.ACTIVE,
      accessTier: AccessTier.FULL,
      adminOverrideTier: null,
      backingMetadata: null,
    ownerOperatorId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      journal: [
        { id: "e1", accountId: "acct_1", entryType: "OPERATOR_GRANT", amount: 5, counterpartyCommitment: null, metadata: null, createdAt: new Date() },
      ],
    } as never);

    updateMock.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: VALID_COMMITMENT,
      accessTier: AccessTier.SANDBOXED,
    });

    const result = await applyAccessEvaluation(VALID_COMMITMENT);
    expect(result.evaluation.tier).toBe(AccessTier.SANDBOXED);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectCommitment: VALID_COMMITMENT },
        data: { accessTier: AccessTier.SANDBOXED },
      })
    );
  });
});

describe("setAdminOverride", () => {
  it("sets admin override tier and re-evaluates access", async () => {
    findUniqueMock.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: VALID_COMMITMENT,
      creditState: AngelCoinCreditState.ACTIVE,
      accessTier: AccessTier.SHELTERED,
      adminOverrideTier: null,
    });

    loadAccountWithJournalMock.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: VALID_COMMITMENT,
      creditState: AngelCoinCreditState.ACTIVE,
      accessTier: AccessTier.SHELTERED,
      adminOverrideTier: AccessTier.FULL,
      backingMetadata: null,
    ownerOperatorId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      journal: [],
    } as never);

    updateMock
      .mockResolvedValueOnce({ adminOverrideTier: AccessTier.FULL })
      .mockResolvedValueOnce({ accessTier: AccessTier.FULL });

    const result = await setAdminOverride(VALID_COMMITMENT, AccessTier.FULL);
    expect(result.evaluation.tier).toBe(AccessTier.FULL);
    expect(result.evaluation.reason).toBe("admin_override");
  });

  it("clears admin override when tier is null", async () => {
    findUniqueMock.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: VALID_COMMITMENT,
    });

    loadAccountWithJournalMock.mockResolvedValue({
      id: "acct_1",
      subjectCommitment: VALID_COMMITMENT,
      creditState: AngelCoinCreditState.ACTIVE,
      accessTier: AccessTier.FULL,
      adminOverrideTier: null,
      backingMetadata: null,
    ownerOperatorId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      journal: [
        { id: "e1", accountId: "acct_1", entryType: "OPERATOR_GRANT", amount: 100, counterpartyCommitment: null, metadata: null, createdAt: new Date() },
      ],
    } as never);

    updateMock.mockResolvedValue({ adminOverrideTier: null, accessTier: AccessTier.FULL });

    await setAdminOverride(VALID_COMMITMENT, null);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adminOverrideTier: null }),
      })
    );
  });
});

describe("safety-net invariants", () => {
  it("SHELTERED tier still allows account to exist and be readable", () => {
    const evaluation = evaluateAccessTier({
      availableBalance: 0,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.ACTIVE,
      adminOverrideTier: null,
    });
    expect(evaluation.tier).toBe(AccessTier.SHELTERED);
    expect(evaluation.tier).not.toBe(AccessTier.SUSPENDED);
  });

  it("SUSPENDED from INACTIVE still preserves identity (not deletion signal)", () => {
    const evaluation = evaluateAccessTier({
      availableBalance: 100,
      lockedBalance: 0,
      creditState: AngelCoinCreditState.INACTIVE,
      adminOverrideTier: null,
    });
    expect(evaluation.tier).toBe(AccessTier.SUSPENDED);
    expect(evaluation.reason).toBe("credit_inactive");
  });
});
