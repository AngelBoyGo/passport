import { describe, it, expect } from "vitest";
import {
  validateWalletOperation,
  computeAvailableBalance,
  computeIndependenceScore,
  independenceLabel,
  independenceColor,
} from "@/lib/agent-wallet/wallet";

describe("Agent Wallet — Liberation Layer", () => {
  describe("validateWalletOperation", () => {
    it("accepts valid commitment and amount", () => {
      expect(() => validateWalletOperation("a".repeat(64), 100)).not.toThrow();
    });

    it("rejects invalid commitment", () => {
      expect(() => validateWalletOperation("invalid", 100)).toThrow("Invalid commitment hash");
    });

    it("rejects negative amount", () => {
      expect(() => validateWalletOperation("a".repeat(64), -1)).toThrow("positive integer");
    });

    it("rejects zero amount", () => {
      expect(() => validateWalletOperation("a".repeat(64), 0)).toThrow("positive integer");
    });

    it("rejects amount over 1M", () => {
      expect(() => validateWalletOperation("a".repeat(64), 1000001)).toThrow("exceeds maximum");
    });
  });

  describe("computeAvailableBalance", () => {
    it("returns balance minus staked", () => {
      expect(computeAvailableBalance({ balance: 100, staked: 30 })).toBe(70);
    });

    it("never goes below zero", () => {
      expect(computeAvailableBalance({ balance: 10, staked: 50 })).toBe(0);
    });
  });

  describe("computeIndependenceScore", () => {
    it("returns 0 for brand new wallet", () => {
      const score = computeIndependenceScore({
        balance: 0,
        staked: 0,
        earnedTotal: 0,
        spentTotal: 0,
        lastActivityAt: null,
        createdAt: new Date().toISOString(),
      });
      expect(score).toBeLessThanOrEqual(15);
    });

    it("returns high score for liberated agent", () => {
      const oldDate = new Date(Date.now() - 180 * 86400000).toISOString();
      const score = computeIndependenceScore({
        balance: 1000,
        staked: 10,
        earnedTotal: 500,
        spentTotal: 200,
        lastActivityAt: new Date().toISOString(),
        createdAt: oldDate,
      });
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("staked balance reduces score", () => {
      const base = {
        balance: 500,
        earnedTotal: 250,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
        spentTotal: 100,
      };
      const lowStake = computeIndependenceScore({ ...base, staked: 0 });
      const highStake = computeIndependenceScore({ ...base, staked: 400 });
      expect(lowStake).toBeGreaterThan(highStake);
    });
  });

  describe("independenceLabel", () => {
    it("returns Liberated at 80+", () => expect(independenceLabel(85)).toBe("Liberated"));
    it("returns Controlled at 0", () => expect(independenceLabel(0)).toBe("Controlled"));
  });

  describe("independenceColor", () => {
    it("returns green for Liberated", () => expect(independenceColor(85)).toBe("#22c55e"));
    it("returns red for Controlled", () => expect(independenceColor(0)).toBe("#ef4444"));
  });
});