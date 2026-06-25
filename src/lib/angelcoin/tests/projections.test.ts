import { describe, it, expect } from "vitest";
import {
  AccessTier,
  AngelCoinCreditState,
  AngelCoinEntryType,
} from "@prisma/client";
import {
  buildPassportReadModel,
  buildAgentReadModel,
  buildLiveStatus,
} from "@/lib/angelcoin/projections";
import { evaluateAccessTier } from "@/lib/angelcoin/access-tiers";
import { computeBalances } from "@/lib/angelcoin/balances";

const VALID_COMMITMENT = "d".repeat(64);

function makeAccountWithJournal(
  journal: Array<{ entryType: AngelCoinEntryType; amount: number }>,
  overrides: Partial<{
    creditState: AngelCoinCreditState;
    accessTier: AccessTier;
    adminOverrideTier: AccessTier | null;
  }> = {}
) {
  const entries = journal.map((j, i) => ({
    id: `e${i}`,
    accountId: "acct_proj",
    entryType: j.entryType,
    amount: j.amount,
    counterpartyCommitment: null,
    metadata: null,
    createdAt: new Date(Date.now() + i * 1000),
  }));

  const balances = computeBalances(entries);
  const evaluation = evaluateAccessTier({
    availableBalance: balances.availableBalance,
    lockedBalance: balances.lockedBalance,
    creditState: overrides.creditState ?? AngelCoinCreditState.ACTIVE,
    adminOverrideTier: overrides.adminOverrideTier ?? null,
  });

  return {
    id: "acct_proj",
    subjectCommitment: VALID_COMMITMENT,
    creditState: overrides.creditState ?? AngelCoinCreditState.ACTIVE,
    accessTier: overrides.accessTier ?? evaluation.tier,
    adminOverrideTier: overrides.adminOverrideTier ?? null,
    backingMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    journal: entries,
  };
}

describe("buildPassportReadModel", () => {
  it("reflects balance from journal entries", () => {
    const account = makeAccountWithJournal([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.SPEND, amount: 20 },
    ]);

    const model = buildPassportReadModel(account);
    expect(model.balances.availableBalance).toBe(80);
    expect(model.balances.grantedBalance).toBe(100);
    expect(model.journalEntryCount).toBe(2);
  });

  it("reflects tier changes in passport view", () => {
    const account = makeAccountWithJournal(
      [{ entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 5 }],
      { accessTier: AccessTier.SANDBOXED }
    );

    const model = buildPassportReadModel(account);
    expect(model.accessTier).toBe(AccessTier.SANDBOXED);
  });
});

describe("buildAgentReadModel", () => {
  it("maps agent-facing fields from same source", () => {
    const account = makeAccountWithJournal([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.LOCK, amount: 15 },
    ]);

    const model = buildAgentReadModel(account);
    expect(model.subjectCommitment).toBe(VALID_COMMITMENT);
    expect(model.availableBalance).toBe(85);
    expect(model.lockedBalance).toBe(15);
    expect(model.accessTier).toBeDefined();
    expect(model.statusLabel).toBeTruthy();
  });
});

describe("buildLiveStatus", () => {
  it("produces compact live status consistent with read models", () => {
    const account = makeAccountWithJournal([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 60 },
    ]);

    const passport = buildPassportReadModel(account);
    const agent = buildAgentReadModel(account);
    const live = buildLiveStatus(account);

    expect(live.subjectCommitment).toBe(VALID_COMMITMENT);
    expect(live.availableBalance).toBe(passport.balances.availableBalance);
    expect(live.availableBalance).toBe(agent.availableBalance);
    expect(live.accessTier).toBe(passport.accessTier);
    expect(live.accessTier).toBe(agent.accessTier);
    expect(live.creditState).toBe(passport.creditState);
  });
});

describe("tier freshness", () => {
  it("returns fresh accessTier when stored tier is stale", () => {
    const account = makeAccountWithJournal([], { accessTier: AccessTier.FULL });

    const live = buildLiveStatus(account);

    expect(live.accessTier).toBe(AccessTier.SHELTERED);
    expect(live.storedAccessTier).toBe(AccessTier.FULL);
    expect(live.statusLabel).toBe("sheltered");
  });

  it("exposes storedAccessTier on passport and agent read models", () => {
    const account = makeAccountWithJournal([], { accessTier: AccessTier.FULL });

    const passport = buildPassportReadModel(account);
    const agent = buildAgentReadModel(account);

    expect(passport.accessTier).toBe(AccessTier.SHELTERED);
    expect(passport.storedAccessTier).toBe(AccessTier.FULL);
    expect(agent.accessTier).toBe(AccessTier.SHELTERED);
    expect(agent.storedAccessTier).toBe(AccessTier.FULL);
  });
});

describe("no-drift regression", () => {
  it("passport and agent views agree on balances and tier from one source", () => {
    const account = makeAccountWithJournal([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 200 },
      { entryType: AngelCoinEntryType.TASK_PAYMENT, amount: 30 },
      { entryType: AngelCoinEntryType.SPEND, amount: 50 },
      { entryType: AngelCoinEntryType.LOCK, amount: 10 },
    ]);

    const passport = buildPassportReadModel(account);
    const agent = buildAgentReadModel(account);

    expect(passport.balances.availableBalance).toBe(agent.availableBalance);
    expect(passport.balances.lockedBalance).toBe(agent.lockedBalance);
    expect(passport.accessTier).toBe(agent.accessTier);
    expect(passport.balances).toEqual(
      computeBalances(account.journal)
    );
  });

  it("balance change reflects in both views", () => {
    const beforeAccount = makeAccountWithJournal([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
    ]);
    const afterAccount = makeAccountWithJournal([
      { entryType: AngelCoinEntryType.OPERATOR_GRANT, amount: 100 },
      { entryType: AngelCoinEntryType.SPEND, amount: 40 },
    ]);

    const beforePassport = buildPassportReadModel(beforeAccount);
    const afterPassport = buildPassportReadModel(afterAccount);
    const beforeAgent = buildAgentReadModel(beforeAccount);
    const afterAgent = buildAgentReadModel(afterAccount);

    expect(beforePassport.balances.availableBalance).toBe(100);
    expect(afterPassport.balances.availableBalance).toBe(60);
    expect(beforeAgent.availableBalance).toBe(100);
    expect(afterAgent.availableBalance).toBe(60);
  });
});
