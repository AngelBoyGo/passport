import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, loadReserveMock, parityMock } = vi.hoisted(() => ({
  prismaMock: {
    agentWallet: { findMany: vi.fn() },
    angelCoinAccount: { upsert: vi.fn(), findUnique: vi.fn() },
    angelCoinJournalEntry: { create: vi.fn(), findMany: vi.fn() },
    agentEnrollment: { findUnique: vi.fn() },
  },
  loadReserveMock: vi.fn(),
  parityMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/monetary/reserve", () => ({ loadFiatReserveUsd: loadReserveMock }));
vi.mock("@/lib/monetary/parity", () => ({ parityStatus: parityMock }));
vi.mock("@/lib/enrollment/enforcement", () => ({ isEnrollmentEnforcedForCredits: vi.fn(() => false) }));

const { grantCredits } = await import("@/lib/angelcoin/ledger-service");

const COMMIT = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ALLOW_UNBACKED_ISSUANCE;
  prismaMock.angelCoinAccount.upsert.mockResolvedValue({ id: "acc_1", subjectCommitment: COMMIT });
  prismaMock.angelCoinJournalEntry.create.mockResolvedValue({ id: "je_1" });
  prismaMock.angelCoinJournalEntry.findMany.mockResolvedValue([{ id: "je_1", accountId: "acc_1", entryType: "OPERATOR_GRANT", amount: 5, counterpartyCommitment: null, metadata: null, createdAt: new Date() }]);
  prismaMock.agentWallet.findMany.mockResolvedValue([{ balance: 100 }]);
});

describe("grantCredits — issuance fails closed on undercollateralization (H2)", () => {
  it("REFUSES a grant when it would break 1:1 backing", async () => {
    loadReserveMock.mockResolvedValue(100); // $100 reserve
    // supply 100 + grant 900 = 1000; required = 1000 * $5 = $5000 >> $100
    parityMock.mockReturnValue({ reserveAdequate: false, requiredReserveUsd: 5000, coverageRatio: 0.02 });
    await expect(grantCredits(COMMIT, 900)).rejects.toThrow(/undercollateralized/);
    expect(prismaMock.angelCoinJournalEntry.create).not.toHaveBeenCalled();
  });

  it("ALLOWS a grant when backing stays adequate", async () => {
    loadReserveMock.mockResolvedValue(1_000_000);
    parityMock.mockReturnValue({ reserveAdequate: true, requiredReserveUsd: 100, coverageRatio: 100 });
    const r = await grantCredits(COMMIT, 5);
    expect(r.entry.id).toBe("je_1");
  });

  it("honours the explicit ALLOW_UNBACKED_ISSUANCE=1 override", async () => {
    process.env.ALLOW_UNBACKED_ISSUANCE = "1";
    const r = await grantCredits(COMMIT, 900);
    expect(r.entry.id).toBe("je_1");
    expect(loadReserveMock).not.toHaveBeenCalled();
  });
});
