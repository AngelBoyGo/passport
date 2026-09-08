import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    fiatFix: { findFirst: vi.fn() },
    moneySettlement: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    agentWallet: { upsert: vi.fn() },
    operatorLedgerEntry: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { settleMobileMoneyOnramp, collectorWalletCommitment } from "../mobile-money";
import { xofToAngel, isXofFixUsable, DEFAULT_XOF_REFERENCE_RATE_USD } from "../fiat-fix";
import {
  handleUssdInteraction,
  __clearUssdSessions,
  __seedUssdSession,
  ussdPinDigest,
  UssdRequest,
} from "../ussd";

const SECRET = "test-secret-0123456789";

// Signs a canonicalized JSON payload with HMAC-SHA256.
function signPayload(payload: Record<string, unknown>): string {
  const mac = createHmac("sha256", SECRET);
  mac.update(sha256Hex(canonicalJson(payload)));
  return mac.digest().toString("hex");
}

const validFix = (overrides: Partial<{ rate: number; validFrom: Date; expiresAt: Date }> = {}) => ({
  id: "fix_1",
  currency: "XOF",
  rateUsdPerUnit: overrides.rate ?? 1 / 600.0,
  source: "BCEAO_DAILY_AVG",
  validFrom: overrides.validFrom ?? new Date(Date.now() - 60_000),
  expiresAt: overrides.expiresAt ?? new Date(Date.now() + 12 * 60 * 60 * 1000),
});

describe("Sahel Digital Money Gateway & Haven On-Ramp (Phase 18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    __clearUssdSessions();
  });

  describe("Fiat Fix (XOF/USD oracle)", () => {
    it("converts XOF to ANGEL via canonical floor division at the peg", () => {
      // 600 XOF = $1.00 USD; 1200 XOF = $2.00 = 0 ANGEL floor... use 3000 XOF = $5.00 = 1 ANGEL
      expect(xofToAngel(3000, 1 / 600.0)).toBe(1);
      // 3000 XOF → 5.00 → floor(5/5) = 1
      expect(xofToAngel(3000, 1 / 600.0)).toBe(1);
      // 6000 XOF → 10.00 → 2
      expect(xofToAngel(6000, 1 / 600.0)).toBe(2);
      // tiny value → 0
      expect(xofToAngel(10, 1 / 600.0)).toBe(0);
      expect(xofToAngel(-5, 1 / 600.0)).toBe(0);
    });

    it("flags stale or out-of-band fixes as unusable", () => {
      expect(isXofFixUsable(1 / 600.0)).toEqual({ usable: true, deviationPct: 0 });
      expect(isXofFixUsable(1 / 500.0).usable).toBe(false); // 20% off
      expect(isXofFixUsable(0)).toEqual({ usable: false, deviationPct: Number.POSITIVE_INFINITY });
    });
  });

  describe("settleMobileMoneyOnramp — exactly-once settlement", () => {
    it("credits a collector wallet once and books the fiat treasury on first callback", async () => {
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix());
      const settlement = {
        id: "set_1",
        provider: "orangemoney",
        externalRef: "TX-0001",
        xofAmount: 6000,
        xofRateUsd: 1 / 600.0,
        creditedAngel: 2,
        targetCommitment: collectorWalletCommitment("TX-0001"),
        status: "SETTLED",
        settledAt: new Date(),
      };
      prismaMock.moneySettlement.create.mockResolvedValue({ ...settlement, status: "PENDING" });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.operatorLedgerEntry.create.mockResolvedValue({});
      prismaMock.moneySettlement.update.mockResolvedValue({ ...settlement });

      const payload = { provider: "orangemoney", transaction_id: "TX-0001", amount: 6000, signature: signPayload({ transaction_id: "TX-0001", amount: 6000 }) };
      const result = await settleMobileMoneyOnramp({ provider: "orangemoney", payload, secret: SECRET });

      expect(result.deduped).toBe(false);
      expect(result.creditedAngel).toBe(2);
      // Collector wallet credited
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subjectCommitment: collectorWalletCommitment("TX-0001") },
          update: expect.objectContaining({ balance: { increment: 2 } }),
        })
      );
      // Fiat treasury booked as sahel_onramp kind
      expect(prismaMock.operatorLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: "sahel_onramp",
            operatorId: "protocol_treasury",
            deltaMicros: Math.round(6000 * (1 / 600.0) * 1_000_000), // = 10 USD in micros
          }),
        })
      );
    });

    it("returns the ORIGINAL event on redelivery (no double credit)", async () => {
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix());
      // First attempt: create succeeds.
      prismaMock.moneySettlement.create.mockResolvedValueOnce({
        id: "set_1",
        provider: "orangemoney",
        externalRef: "TX-0001",
        status: "PENDING",
      });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.operatorLedgerEntry.create.mockResolvedValue({});
      prismaMock.moneySettlement.update.mockResolvedValue({ id: "set_1", status: "SETTLED" });

      const payload = { provider: "orangemoney", transaction_id: "TX-0001", amount: 3000, signature: signPayload({ transaction_id: "TX-0001", amount: 3000 }) };
      const first = await settleMobileMoneyOnramp({ provider: "orangemoney", payload, secret: SECRET });
      expect(first.deduped).toBe(false);

      // Second (redelivered): create throws unique-violation → deduped read.
      prismaMock.moneySettlement.create.mockRejectedValueOnce(new Error("Unique constraint failed"));
      prismaMock.moneySettlement.findUnique.mockResolvedValueOnce({
        id: "set_1",
        provider: "orangemoney",
        externalRef: "TX-0001",
        xofAmount: 3000,
        xofRateUsd: 1 / 600.0,
        creditedAngel: 1,
        targetCommitment: collectorWalletCommitment("TX-0001"),
        status: "SETTLED",
      });
      const second = await settleMobileMoneyOnramp({ provider: "orangemoney", payload, secret: SECRET });

      expect(second.deduped).toBe(true);
      expect(second.settlementId).toBe("set_1");
      // No extra credit: upsert called exactly once across the whole test.
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("settleMobileMoneyOnramp — protection & atomicity", () => {
    it("refuses on-ramp when the XOF fix is stale or out-of-band", async () => {
      prismaMock.fiatFix.findFirst.mockResolvedValue(
        validFix({ expiresAt: new Date(Date.now() - 60_000) })
      );
      const payload = { provider: "momo", external_reference: "M-1", amount: 6000 };
      await expect(
        settleMobileMoneyOnramp({ provider: "momo", payload, secret: SECRET })
      ).rejects.toThrow(/stale/i);

      prismaMock.fiatFix.findFirst.mockResolvedValue(
        validFix({ rate: 1 / 300.0 }) // 100% off reference
      );
      await expect(
        settleMobileMoneyOnramp({ provider: "momo", payload, secret: SECRET })
      ).rejects.toThrow(/deviates/i);
      // No settlement row ever created
      expect(prismaMock.moneySettlement.create).not.toHaveBeenCalled();
    });

    it("throws in production on an invalid provider signature", async () => {
      const prev = process.env.NODE_ENV;
      (process.env as Record<string, string>)["NODE_ENV"] = "production";
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix());
      try {
        const payload = { provider: "moov", order_no: "O-1", amount: 6000_00, signature: "bad" };
        await expect(
          settleMobileMoneyOnramp({ provider: "moov", payload, secret: SECRET })
        ).rejects.toThrow(/signature/i);
      } finally {
        (process.env as Record<string, string>)["NODE_ENV"] = prev ?? "";
      }
    });

    it("marks the settlement PENDING_REVIEW and does not credit on an atomic failure", async () => {
      prismaMock.fiatFix.findFirst.mockResolvedValue(validFix());
      const payload = { provider: "orangemoney", transaction_id: "TX-FAIL", amount: 6000, signature: "x" };
      // create succeeds
      prismaMock.moneySettlement.create.mockResolvedValueOnce({
        id: "set_fail",
        provider: "orangemoney",
        externalRef: "TX-FAIL",
        status: "PENDING",
      });
      // wallet upsert throws (atomic failure)
      prismaMock.agentWallet.upsert.mockRejectedValueOnce(new Error("db down"));
      prismaMock.moneySettlement.update.mockResolvedValue({ id: "set_fail", status: "PENDING_REVIEW" });

      await expect(
        settleMobileMoneyOnramp({ provider: "orangemoney", payload, secret: SECRET })
      ).rejects.toThrow(/db down/);

      // Fail-close: flagged for review, never credited.
      expect(prismaMock.moneySettlement.update).toHaveBeenCalledWith({
        where: { id: "set_fail" },
        data: { status: "PENDING_REVIEW" },
      });
      expect(prismaMock.operatorLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("USSD session state machine", () => {
    const req = (input: string, sid = "S1"): UssdRequest => ({ sessionId: sid, phoneNumber: "+22300000000", input });

    it("authenticates with MPIN and serves the menu", async () => {
      __seedUssdSession({
        sessionId: "S1",
        phoneNumber: "+22300000000",
        state: "AWAITING_PIN",
        lastActivityAt: Date.now(),
      });
      const r1 = await handleUssdInteraction(req("1234"));
      expect(r1.reply.startsWith("CON 1 BAL 2 BUY 3 EXIT")).toBe(true);

      const r2 = await handleUssdInteraction(req("1"));
      expect(r2.reply).toContain("BAL");
      expect(r2.done).toBe(false);
    });

    it("rejects an invalid MPIN format", async () => {
      __seedUssdSession({
        sessionId: "S1",
        phoneNumber: "+22300000000",
        state: "AWAITING_PIN",
        lastActivityAt: Date.now(),
      });
      const r = await handleUssdInteraction(req("12")); // 2 digits
      expect(r.reply).toContain("4 digits");
      expect(r.done).toBe(false);
    });

    it("completes a BUY via the settlement callback and terminates", async () => {
      __seedUssdSession({
        sessionId: "S1",
        phoneNumber: "+22300000000",
        state: "MENU",
        mPinDigest: ussdPinDigest("1234"),
        lastActivityAt: Date.now(),
      });
      const buy = await handleUssdInteraction(req("2"));
      expect(buy.reply).toContain("amount in XOF");

      const amt = await handleUssdInteraction(req("3000"));
      expect(amt.reply).toContain("3,000 XOF");

      __clearUssdSessions();
      __seedUssdSession({
        sessionId: "S1",
        phoneNumber: "+22300000000",
        state: "AWAITING_BUY_CONFIRM",
        pendingBuyXof: 3000,
        lastActivityAt: Date.now(),
      });
      const settled = await handleUssdInteraction(req("1"), {
        onBuyConfirm: async (xof) => ({ creditedAngel: xof / 3000, reference: "set_s1" }),
      });
      expect(settled.reply).toContain("SUCCESS");
      expect(settled.reply).toContain("1 ANGEL");
      expect(settled.done).toBe(true);
    });
  });
});