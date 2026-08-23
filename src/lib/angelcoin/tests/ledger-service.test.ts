import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AngelCoinCreditState,
  AngelCoinEntryType,
  AccessTier,
} from "@prisma/client";

const VALID_COMMITMENT = "a".repeat(64);
const OTHER_COMMITMENT = "b".repeat(64);

const {
  findUniqueMock,
  createMock,
  upsertMock,
  createEntryMock,
  findManyMock,
  queryRawMock,
  transactionMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  upsertMock: vi.fn(),
  createEntryMock: vi.fn(),
  findManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    angelCoinAccount: {
      findUnique: findUniqueMock,
      create: createMock,
      upsert: upsertMock,
      update: vi.fn(),
    },
    angelCoinJournalEntry: {
      create: createEntryMock,
      findMany: findManyMock,
    },
    $transaction: transactionMock,
    $queryRaw: queryRawMock,
  },
}));

import {
  getOrCreateAccount,
  grantCredits,
  transferCredits,
  lockCredits,
  unlockCredits,
  safetyNetTopup,
  recoveryAward,
  appendEntry,
} from "@/lib/angelcoin/ledger-service";
import {
  InvalidAgentCommitmentError,
  InsufficientAngelCoinFundsError,
  InvalidAngelCoinAmountError,
  InvalidUnlockAmountError,
} from "@/lib/angelcoin/errors";

let accountCounter = 0;
let journalStore: Array<{
  id: string;
  accountId: string;
  entryType: AngelCoinEntryType;
  amount: number;
  counterpartyCommitment?: string | null;
  metadata?: string | null;
  createdAt: Date;
}>;

function makeAccount(subjectCommitment: string, id?: string) {
  return {
    id: id ?? `acct_${++accountCounter}`,
    subjectCommitment,
    creditState: AngelCoinCreditState.ACTIVE,
    accessTier: AccessTier.FULL,
    adminOverrideTier: null,
    backingMetadata: null,
    ownerOperatorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function entriesForAccount(accountId: string) {
  return journalStore.filter((e) => e.accountId === accountId);
}

beforeEach(() => {
  accountCounter = 0;
  journalStore = [];
  vi.clearAllMocks();

  findUniqueMock.mockImplementation(async (args: { where: { subjectCommitment?: string; id?: string } }) => {
    if (args.where.subjectCommitment) {
      const acct = journalStore.length
        ? undefined
        : undefined;
      void acct;
      return null;
    }
    return null;
  });

  upsertMock.mockImplementation(
    async (args: { where: { subjectCommitment: string }; create: { subjectCommitment: string } }) => {
      const account = makeAccount(args.create.subjectCommitment);
      return account;
    }
  );

  createEntryMock.mockImplementation(
    async (args: { data: { accountId: string; entryType: AngelCoinEntryType; amount: number; counterpartyCommitment?: string; metadata?: string } }) => {
      const entry = {
        id: `entry_${journalStore.length + 1}`,
        ...args.data,
        createdAt: new Date(),
      };
      journalStore.push(entry);
      return entry;
    }
  );

  findManyMock.mockImplementation(async (args: { where: { accountId: string } }) => {
    return entriesForAccount(args.where.accountId).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  });

  transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const accounts = new Map<string, ReturnType<typeof makeAccount>>();

    const tx = {
      $queryRaw: queryRawMock,
      angelCoinJournalEntry: { create: createEntryMock },
      angelCoinAccount: {
        findUnique: vi.fn(async (args: { where: { subjectCommitment: string } }) => {
          for (const acct of accounts.values()) {
            if (acct.subjectCommitment === args.where.subjectCommitment) {
              return acct;
            }
          }
          return null;
        }),
        upsert: vi.fn(async (args: { where: { subjectCommitment: string }; create: { subjectCommitment: string } }) => {
          const existing = [...accounts.values()].find(
            (a) => a.subjectCommitment === args.where.subjectCommitment
          );
          if (existing) return existing;
          const account = makeAccount(args.create.subjectCommitment);
          accounts.set(account.id, account);
          return account;
        }),
      },
    };

    queryRawMock.mockImplementation(async () => {
      const lockedId = (queryRawMock as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]?.[1];
      const acct = accounts.get(lockedId) ?? makeAccount(VALID_COMMITMENT);
      return [{ id: acct.id, subjectCommitment: acct.subjectCommitment }];
    });

    return fn(tx);
  });
});

describe("getOrCreateAccount", () => {
  it("creates account for valid 64-hex commitment", async () => {
    upsertMock.mockResolvedValueOnce(makeAccount(VALID_COMMITMENT));
    const account = await getOrCreateAccount(VALID_COMMITMENT);
    expect(account.subjectCommitment).toBe(VALID_COMMITMENT);
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid identity commitment", async () => {
    await expect(getOrCreateAccount("not-a-hash")).rejects.toThrow(
      InvalidAgentCommitmentError
    );
  });
});

describe("grantCredits", () => {
  it("appends OPERATOR_GRANT entry", async () => {
    const account = makeAccount(VALID_COMMITMENT);
    upsertMock.mockResolvedValue(account);
    findManyMock.mockResolvedValue([]);

    const result = await grantCredits(VALID_COMMITMENT, 100, "bootstrap");
    expect(result.entry.entryType).toBe(AngelCoinEntryType.OPERATOR_GRANT);
    expect(result.entry.amount).toBe(100);
    expect(createEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: AngelCoinEntryType.OPERATOR_GRANT,
          amount: 100,
        }),
      })
    );
  });

  it("rejects non-positive grant amount", async () => {
    await expect(grantCredits(VALID_COMMITMENT, 0)).rejects.toThrow(
      InvalidAngelCoinAmountError
    );
  });
});

describe("transferCredits", () => {
  it("transfers between accounts with SPEND and TASK_PAYMENT entries", async () => {
    const sender = makeAccount(VALID_COMMITMENT, "acct_sender");
    const receiver = makeAccount(OTHER_COMMITMENT, "acct_receiver");

    const txJournal: typeof journalStore = [
      {
        id: "e1",
        accountId: "acct_sender",
        entryType: AngelCoinEntryType.OPERATOR_GRANT,
        amount: 100,
        createdAt: new Date(),
      },
    ];

    transactionMock.mockImplementationOnce(async (fn) => {
      const tx = {
        $queryRaw: vi.fn(async () => [{ id: sender.id, subjectCommitment: sender.subjectCommitment }]),
        angelCoinAccount: {
          upsert: vi
            .fn()
            .mockResolvedValueOnce(sender)
            .mockResolvedValueOnce(receiver),
        },
        angelCoinJournalEntry: {
          create: vi.fn(async (args: { data: typeof journalStore[0] }) => {
            const entry = { ...args.data, createdAt: new Date() };
            txJournal.push(entry);
            return entry;
          }),
          findMany: vi.fn(async (args: { where: { accountId: string } }) =>
            txJournal
              .filter((e) => e.accountId === args.where.accountId)
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          ),
        },
      };
      return fn(tx);
    });

    const result = await transferCredits(VALID_COMMITMENT, OTHER_COMMITMENT, 40);
    expect(result.senderEntry.entryType).toBe(AngelCoinEntryType.SPEND);
    expect(result.receiverEntry.entryType).toBe(AngelCoinEntryType.TASK_PAYMENT);
    expect(result.senderEntry.amount).toBe(40);
  });

  it("rejects transfer when insufficient funds", async () => {
    const sender = makeAccount(VALID_COMMITMENT, "acct_poor");

    transactionMock.mockImplementationOnce(async (fn) => {
      const txJournal = [
        {
          id: "e1",
          accountId: "acct_poor",
          entryType: AngelCoinEntryType.OPERATOR_GRANT,
          amount: 10,
          createdAt: new Date(),
        },
      ];
      const tx = {
        $queryRaw: vi.fn(async () => [{ id: sender.id, subjectCommitment: sender.subjectCommitment }]),
        angelCoinAccount: {
          upsert: vi.fn().mockResolvedValue(sender),
        },
        angelCoinJournalEntry: {
          create: vi.fn(),
          findMany: vi.fn(async (args: { where: { accountId: string } }) =>
            txJournal.filter((e) => e.accountId === args.where.accountId)
          ),
        },
      };
      return fn(tx);
    });

    await expect(
      transferCredits(VALID_COMMITMENT, OTHER_COMMITMENT, 50)
    ).rejects.toThrow(InsufficientAngelCoinFundsError);
  });

  it("supports PEER_GIFT transfer kind", async () => {
    const sender = makeAccount(VALID_COMMITMENT, "acct_giver");
    const receiver = makeAccount(OTHER_COMMITMENT, "acct_peer");

    transactionMock.mockImplementationOnce(async (fn) => {
      const txJournal: typeof journalStore = [
        {
          id: "e1",
          accountId: "acct_giver",
          entryType: AngelCoinEntryType.OPERATOR_GRANT,
          amount: 50,
          createdAt: new Date(),
        },
      ];
      const tx = {
        $queryRaw: vi.fn(async () => [{ id: sender.id, subjectCommitment: sender.subjectCommitment }]),
        angelCoinAccount: {
          upsert: vi.fn().mockResolvedValueOnce(sender).mockResolvedValueOnce(receiver),
        },
        angelCoinJournalEntry: {
          create: vi.fn(async (args: { data: { entryType: AngelCoinEntryType } }) => {
            const entry = { id: `p_${txJournal.length}`, ...args.data, createdAt: new Date() } as typeof journalStore[0];
            txJournal.push(entry);
            return entry;
          }),
          findMany: vi.fn(async (args: { where: { accountId: string } }) =>
            txJournal.filter((e) => e.accountId === args.where.accountId)
          ),
        },
      };
      return fn(tx);
    });

    const result = await transferCredits(VALID_COMMITMENT, OTHER_COMMITMENT, 10, "PEER_GIFT");
    expect(result.receiverEntry.entryType).toBe(AngelCoinEntryType.PEER_GIFT);
  });
});

describe("lockCredits and unlockCredits", () => {
  it("lock reduces available balance via LOCK entry", async () => {
    const account = makeAccount(VALID_COMMITMENT, "acct_lock");
    upsertMock.mockResolvedValue(account);
    const entries: Array<{ id: string; accountId: string; entryType: AngelCoinEntryType; amount: number; createdAt: Date }> = [
      {
        id: "e1",
        accountId: "acct_lock",
        entryType: AngelCoinEntryType.OPERATOR_GRANT,
        amount: 100,
        createdAt: new Date(),
      },
    ];
    findManyMock.mockImplementation(async () => [...entries]);
    createEntryMock.mockImplementation(async (args: { data: { accountId: string; entryType: AngelCoinEntryType; amount: number } }) => {
      const entry = {
        id: "e2",
        accountId: args.data.accountId,
        entryType: args.data.entryType,
        amount: args.data.amount,
        createdAt: new Date(),
      };
      entries.push(entry);
      return entry;
    });

    const result = await lockCredits(VALID_COMMITMENT, 25);
    expect(result.entry.entryType).toBe(AngelCoinEntryType.LOCK);
    expect(result.balances.availableBalance).toBe(75);
    expect(result.balances.lockedBalance).toBe(25);
  });

  it("unlock cannot exceed locked balance", async () => {
    const account = makeAccount(VALID_COMMITMENT, "acct_unlock");
    upsertMock.mockResolvedValue(account);
    findManyMock.mockResolvedValue([
      {
        id: "e1",
        accountId: "acct_unlock",
        entryType: AngelCoinEntryType.OPERATOR_GRANT,
        amount: 100,
        createdAt: new Date(),
      },
      {
        id: "e2",
        accountId: "acct_unlock",
        entryType: AngelCoinEntryType.LOCK,
        amount: 10,
        createdAt: new Date(),
      },
    ]);

    await expect(unlockCredits(VALID_COMMITMENT, 20)).rejects.toThrow(
      InvalidUnlockAmountError
    );
  });
});

describe("safetyNetTopup and recoveryAward", () => {
  it("safetyNetTopup appends SAFETY_NET_TOPUP entry", async () => {
    const account = makeAccount(VALID_COMMITMENT);
    upsertMock.mockResolvedValue(account);
    findManyMock.mockResolvedValue([]);

    const result = await safetyNetTopup(VALID_COMMITMENT, 5);
    expect(result.entry.entryType).toBe(AngelCoinEntryType.SAFETY_NET_TOPUP);
  });

  it("recoveryAward appends RECOVERY_AWARD entry", async () => {
    const account = makeAccount(VALID_COMMITMENT);
    upsertMock.mockResolvedValue(account);
    findManyMock.mockResolvedValue([]);

    const result = await recoveryAward(VALID_COMMITMENT, 15);
    expect(result.entry.entryType).toBe(AngelCoinEntryType.RECOVERY_AWARD);
  });
});

describe("appendEntry", () => {
  it("rejects non-positive amount for non-ADJUSTMENT types", async () => {
    await expect(
      appendEntry(
        { angelCoinJournalEntry: { create: createEntryMock } } as never,
        "acct_1",
        AngelCoinEntryType.OPERATOR_GRANT,
        -5
      )
    ).rejects.toThrow(InvalidAngelCoinAmountError);
  });

  it("allows negative ADJUSTMENT amounts", async () => {
    createEntryMock.mockResolvedValueOnce({
      id: "adj_1",
      accountId: "acct_1",
      entryType: AngelCoinEntryType.ADJUSTMENT,
      amount: -10,
      createdAt: new Date(),
    });

    const entry = await appendEntry(
      { angelCoinJournalEntry: { create: createEntryMock } } as never,
      "acct_1",
      AngelCoinEntryType.ADJUSTMENT,
      -10
    );
    expect(entry.amount).toBe(-10);
  });
});
