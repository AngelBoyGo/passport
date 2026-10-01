/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks use partial Prisma rows and mock objects */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock, createMock, updateMock, updateManyMock, operatorUpdateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  updateManyMock: vi.fn(),
  operatorUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    referralCode: {
      findUnique: findUniqueMock,
      create: createMock,
      update: vi.fn((args: any) => updateMock(args)),
      updateMany: vi.fn((args: any) => updateManyMock(args)),
    },
    operator: {
      update: vi.fn((args: any) => operatorUpdateMock(args)),
    },
    $transaction: vi.fn(async (fn: any) => {
      const tx = {
        referralCode: { update: vi.fn((args: any) => updateMock(args)) },
        operator: { update: vi.fn((args: any) => operatorUpdateMock(args)) },
      };
      return fn(tx);
    }),
  },
}));

import { generateReferralCode, redeemReferralCode, getReferralCode } from "@/lib/referral/referral-service";

let findUniqueImpl: ((args: any) => any) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueImpl = null;
  findUniqueMock.mockImplementation((args: any) => {
    if (findUniqueImpl) return findUniqueImpl(args);
    return null;
  });
  // Default: the atomic cap guard succeeds (one row claimed).
  updateManyMock.mockResolvedValue({ count: 1 });
});

describe("generateReferralCode", () => {
  it("generates a new code for an operator who doesn't have one", async () => {
    findUniqueImpl = () => null;
    createMock.mockImplementation(async (args: any) => ({ ...args, code: "generated" }));

    const result = await generateReferralCode("op_1");
    expect(result.code).toBeTruthy();
    expect(result.code.length).toBeGreaterThanOrEqual(4);
    expect(result.bonusCredits).toBeGreaterThanOrEqual(1);
  });

  it("returns existing code if operator already has one", async () => {
    findUniqueImpl = () => ({ code: "existing", operatorId: "op_1", bonusCredits: 50 });

    const result = await generateReferralCode("op_1");
    expect(result.code).toBe("existing");
    expect(result.bonusCredits).toBe(50);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("redeemReferralCode", () => {
  it("returns not_found for unknown code", async () => {
    findUniqueImpl = () => null;
    const result = await redeemReferralCode("unknown", "op_redeemer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("returns bonus credits for a valid code redeemed by another operator", async () => {
    findUniqueImpl = () => ({ id: "r_1", operatorId: "op_referrer", bonusCredits: 50, totalUsed: 0 });
    const result = await redeemReferralCode("valid123", "op_redeemer");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bonusCredits).toBe(50);
      expect(result.operatorId).toBe("op_referrer");
    }
  });

  it("rejects self-referral (audit fix H4)", async () => {
    findUniqueImpl = () => ({ id: "r_1", operatorId: "op_self", bonusCredits: 50, totalUsed: 0 });
    const result = await redeemReferralCode("mycode", "op_self");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self_referral");
    expect(operatorUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects when the code is at its lifetime cap", async () => {
    findUniqueImpl = () => ({ id: "r_1", operatorId: "op_referrer", bonusCredits: 50, totalUsed: 999 });
    const result = await redeemReferralCode("hot", "op_redeemer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("capped");
  });

  it("rejects when the atomic cap guard loses the race", async () => {
    findUniqueImpl = () => ({ id: "r_1", operatorId: "op_referrer", bonusCredits: 50, totalUsed: 0 });
    updateManyMock.mockResolvedValue({ count: 0 });
    const result = await redeemReferralCode("race", "op_redeemer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("capped");
    expect(operatorUpdateMock).not.toHaveBeenCalled();
  });
});

describe("getReferralCode", () => {
  it("returns null for operator without code", async () => {
    findUniqueImpl = () => null;
    const result = await getReferralCode("op_none");
    expect(result).toBeNull();
  });

  it("returns code for operator with one", async () => {
    findUniqueImpl = () => ({ code: "mycode", totalUsed: 3, bonusCredits: 50 });
    const result = await getReferralCode("op_1");
    expect(result!.code).toBe("mycode");
    expect(result!.totalUsed).toBe(3);
  });
});