import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateProtocolFee, PROTOCOL_TREASURY_COMMITMENT } from "@/lib/revenue/protocol-fees";

describe("Protocol Fee Engine", () => {
  describe("calculateProtocolFee", () => {
    it("charges 2% on standard amounts", () => {
      const { fee, net, gross } = calculateProtocolFee(100);
      expect(fee).toBe(2);
      expect(net).toBe(98);
      expect(gross).toBe(100);
    });

    it("charges minimum 1 ANGL fee on small amounts", () => {
      const { fee } = calculateProtocolFee(10);
      expect(fee).toBe(1); // 2% of 10 = 0.2, floored to 1 min
    });

    it("handles large amounts", () => {
      const { fee, net } = calculateProtocolFee(50000);
      expect(fee).toBe(1000); // 2% of 50000
      expect(net).toBe(49000);
    });

    it("returns zero for zero or negative amounts", () => {
      expect(calculateProtocolFee(0).fee).toBe(0);
      expect(calculateProtocolFee(-100).fee).toBe(0);
      expect(calculateProtocolFee(NaN).fee).toBe(0);
    });

    it("fee + net always equals gross", () => {
      for (const amount of [1, 10, 100, 1000, 50000]) {
        const { fee, net, gross } = calculateProtocolFee(amount);
        expect(fee + net).toBe(gross);
      }
    });
  });

  describe("PROTOCOL_TREASURY_COMMITMENT", () => {
    it("is a system-owned address", () => {
      expect(PROTOCOL_TREASURY_COMMITMENT).toBe("protocol_treasury_system");
    });
  });
});