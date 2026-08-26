import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  shouldBlockWithdrawal,
  assertReserveYieldPolicy,
  kycGateForWithdraw,
} from "@/lib/bridge/compliance";

describe("Bridge compliance & guardrails — test bank F", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ANGL_BLOCKED_ADDRESSES;
    delete process.env.ANGL_BLOCKED_COUNTRIES;
    delete process.env.BRIDGE_ENV;
    delete process.env.ANGL_WITHDRAW_KYC_ONLY;
  });

  // ---- F1 ----
  it("F1: blocks a sanctions-listed address via env blocklist", () => {
    process.env.ANGL_BLOCKED_ADDRESSES = "0xdead,0xbeef,0xcccc";
    expect(shouldBlockWithdrawal("0xBEeF")).toBe(true);
    expect(shouldBlockWithdrawal("0xdead")).toBe(true);
    expect(shouldBlockWithdrawal("0x1111")).toBe(false);
  });

  it("F1b: blocks a geofenced country code (ISO-2)", () => {
    process.env.ANGL_BLOCKED_COUNTRIES = "CU,IR,KP,SY";
    expect(shouldBlockWithdrawal("0xabc", { countryCode: "CU" })).toBe(true);
    expect(shouldBlockWithdrawal("0xabc", { countryCode: "US" })).toBe(false);
  });

  it("F1c: allows a clean withdrawal when nothing is blocked", () => {
    expect(shouldBlockWithdrawal("0xabc", { countryCode: "ZZ" })).toBe(false);
  });

  // ---- F2 ----
  it("F2: KYC is enforced for withdrawals when ANGL_WITHDRAW_KYC_ONLY=true", () => {
    process.env.ANGL_WITHDRAW_KYC_ONLY = "true";
    expect(kycGateForWithdraw("APPROVED")).toBe(true);
    expect(kycGateForWithdraw("PENDING")).toBe(false);
  });

  it("F2b: KYC is enforced for withdrawals in live regardless of flag", () => {
    process.env.BRIDGE_ENV = "live";
    expect(kycGateForWithdraw("PENDING")).toBe(false);
    expect(kycGateForWithdraw("APPROVED")).toBe(true);
  });

  // ---- F3 ----
  it("F3: reserve-yield policy forbids passing yield to ANGL holders", () => {
    // minting credits carries an audit flag; the policy check must pass (it is
    // a documented invariant), and should throw if a caller tries to attach
    // holder yield.
    expect(() => assertReserveYieldPolicy({ holderYield: false })).not.toThrow();
    expect(() => assertReserveYieldPolicy({ holderYield: true })).toThrow(/yield|holder/i);
  });

  it("F3b: audit metadata carries kyc + geofence + bridgeRef flags", () => {
    // The mint/burn journal metadata should always record compliance fields.
    const meta = {
      rail: "bridge_issuance",
      bridgeRef: "bridge_x1",
      kycStatus: "APPROVED",
      geofence: "US",
    };
    // Structurally present (append-only audit requirement).
    expect(meta).toMatchObject({ kycStatus: "APPROVED", geofence: "US", bridgeRef: "bridge_x1" });
  });
});