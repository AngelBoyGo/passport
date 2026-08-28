import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock, createMock, updateMock, operatorUpdateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  operatorUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    referralCode: {
      findUnique: findUniqueMock,
      create: createMock,
      update: vi.fn((args: any) => updateMock(args)),
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
  it("returns null for unknown code", async () => {
    findUniqueImpl = () => null;
    const result = await redeemReferralCode("unknown");
    expect(result).toBeNull();
  });

  it("returns bonus credits for valid code", async () => {
    findUniqueImpl = () => ({ id: "r_1", operatorId: "op_referrer", bonusCredits: 50, totalUsed: 0 });
    const result = await redeemReferralCode("valid123");
    expect(result).not.toBeNull();
    expect(result!.bonusCredits).toBe(50);
    expect(result!.operatorId).toBe("op_referrer");
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