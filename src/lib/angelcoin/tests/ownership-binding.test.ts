import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    angelCoinAccount: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  getOrCreateAccount,
  assertCanTransferFrom,
} from "@/lib/angelcoin/ledger-service";

describe("AngelCoin ownership binding (Loop 37 — HIGH)", () => {
  const commitment = "a".repeat(64);
  const opA = "op_A";
  const opB = "op_B";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds owner on CREATE", async () => {
    prismaMock.angelCoinAccount.upsert.mockResolvedValue({
      id: "acct1",
      subjectCommitment: commitment,
      ownerOperatorId: opA,
    });
    await getOrCreateAccount(commitment, opA);
    expect(prismaMock.angelCoinAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ownerOperatorId: opA }),
      })
    );
  });

  it("BINDS a pre-existing NULL-owner account to the claiming operator (was a no-op before)", async () => {
    // Existing account with null owner.
    prismaMock.angelCoinAccount.upsert.mockResolvedValue({
      id: "acct2",
      subjectCommitment: commitment,
      ownerOperatorId: null,
    });
    // Conditional bind succeeds (1 row updated).
    prismaMock.angelCoinAccount.updateMany.mockResolvedValue({ count: 1 });

    await getOrCreateAccount(commitment, opB);

    // Must issue a conditional bind targeting ONLY null-owner rows for this account.
    expect(prismaMock.angelCoinAccount.updateMany).toHaveBeenCalledWith({
      where: { subjectCommitment: commitment, ownerOperatorId: null },
      data: { ownerOperatorId: opB },
    });
  });

  it("never overwrites an existing owner's binding", async () => {
    prismaMock.angelCoinAccount.upsert.mockResolvedValue({
      id: "acct3",
      subjectCommitment: commitment,
      ownerOperatorId: opA,
    });
    await getOrCreateAccount(commitment, opB);
    // Account is already owned by op_A → no bind may be issued at all,
    // so op_B can never steal ownership.
    expect(prismaMock.angelCoinAccount.updateMany).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED: a still-null-owner account cannot be drained by another operator", async () => {
    // After claim attempt, the account remains unowned (e.g. concurrent race lost).
    prismaMock.angelCoinAccount.findUnique.mockResolvedValue({
      ownerOperatorId: null,
    });

    // Non-admin caller, account unowned → deny.
    const allowed = await assertCanTransferFrom(opB, commitment, false);
    expect(allowed).toBe(false);
  });

  it("allows transfer when the caller owns the source account", async () => {
    prismaMock.angelCoinAccount.findUnique.mockResolvedValue({ ownerOperatorId: opA });
    const allowed = await assertCanTransferFrom(opA, commitment, false);
    expect(allowed).toBe(true);
  });

  it("denies transfer when a DIFFERENT operator owns the source", async () => {
    prismaMock.angelCoinAccount.findUnique.mockResolvedValue({ ownerOperatorId: opA });
    const allowed = await assertCanTransferFrom(opB, commitment, false);
    expect(allowed).toBe(false);
  });

  it("executive admin bypasses the ownership gate", async () => {
    const allowed = await assertCanTransferFrom(opB, commitment, true);
    expect(allowed).toBe(true);
    expect(prismaMock.angelCoinAccount.findUnique).not.toHaveBeenCalled();
  });
});
