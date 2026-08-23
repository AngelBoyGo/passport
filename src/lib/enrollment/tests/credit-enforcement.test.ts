import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";

const requireEnrolledMock = vi.fn();
const isEnrollmentEnforcedForCreditsMock = vi.fn();

vi.mock("@/lib/enrollment/enrollment-service", () => ({
  requireEnrolled: (...args: unknown[]) => requireEnrolledMock(...args),
  isEnrollmentEnforcedForCredits: () => isEnrollmentEnforcedForCreditsMock(),
}));

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

import { grantCredits, transferCredits } from "@/lib/angelcoin/ledger-service";
import { NotEnrolledError } from "@/lib/enrollment/errors";
import {
  AngelCoinCreditState,
  AngelCoinEntryType,
  AccessTier,
} from "@prisma/client";

const VALID_COMMITMENT = "a".repeat(64);
const OTHER_COMMITMENT = "b".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  isEnrollmentEnforcedForCreditsMock.mockReturnValue(false);
  requireEnrolledMock.mockResolvedValue({
    subjectCommitment: VALID_COMMITMENT,
    status: EnrollmentStatus.ISSUED,
  });

  findUniqueMock.mockResolvedValue(null);
  createMock.mockImplementation(async (args: { data: { subjectCommitment: string } }) => ({
    id: "acct_1",
    subjectCommitment: args.data.subjectCommitment,
    creditState: AngelCoinCreditState.ACTIVE,
    accessTier: AccessTier.FULL,
    adminOverrideTier: null,
    backingMetadata: null,
    ownerOperatorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  upsertMock.mockImplementation(async (args: { where: { subjectCommitment: string }; create: { subjectCommitment: string } }) => ({
    id: "acct_1",
    subjectCommitment: args.where.subjectCommitment ?? args.create.subjectCommitment,
    creditState: AngelCoinCreditState.ACTIVE,
    accessTier: AccessTier.FULL,
    adminOverrideTier: null,
    backingMetadata: null,
    ownerOperatorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  createEntryMock.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "entry_1",
    ...args.data,
    createdAt: new Date(),
  }));
  findManyMock.mockResolvedValue([]);
});

describe("credit enrollment enforcement flag", () => {
  it("does not require enrollment when flag is off", async () => {
    isEnrollmentEnforcedForCreditsMock.mockReturnValue(false);
    await grantCredits(VALID_COMMITMENT, 10);
    expect(requireEnrolledMock).not.toHaveBeenCalled();
  });

  it("requires enrollment for grants when flag is on", async () => {
    isEnrollmentEnforcedForCreditsMock.mockReturnValue(true);
    await grantCredits(VALID_COMMITMENT, 10);
    expect(requireEnrolledMock).toHaveBeenCalledWith(VALID_COMMITMENT);
  });

  it("blocks grants when flag is on and subject is not enrolled", async () => {
    isEnrollmentEnforcedForCreditsMock.mockReturnValue(true);
    requireEnrolledMock.mockRejectedValue(new NotEnrolledError());
    await expect(grantCredits(VALID_COMMITMENT, 10)).rejects.toThrow(
      NotEnrolledError
    );
  });

  it("requires enrollment for transfers when flag is on", async () => {
    isEnrollmentEnforcedForCreditsMock.mockReturnValue(true);
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        angelCoinAccount: {
          upsert: upsertMock,
        },
        angelCoinJournalEntry: {
          create: createEntryMock,
          findMany: findManyMock,
        },
        $queryRaw: queryRawMock.mockResolvedValue([
          { id: "acct_sender", subjectCommitment: VALID_COMMITMENT },
        ]),
      };
      findManyMock.mockResolvedValue([
        {
          id: "entry_grant",
          accountId: "acct_sender",
          entryType: AngelCoinEntryType.OPERATOR_GRANT,
          amount: 100,
          createdAt: new Date(),
        },
      ]);
      return fn(tx);
    });

    await transferCredits(VALID_COMMITMENT, OTHER_COMMITMENT, 10);
    expect(requireEnrolledMock).toHaveBeenCalledWith(VALID_COMMITMENT);
  });
});
