import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operator: { findUnique: vi.fn(), update: vi.fn() },
    capabilityLedgerEntry: { findFirst: vi.fn(), create: vi.fn() },
    externalSettlement: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { meterAttestation, recordCapabilityEvent } = vi.hoisted(() => ({
  meterAttestation: vi.fn(),
  recordCapabilityEvent: vi.fn(async () => ({})),
}));

vi.mock("@/lib/metering/attestation-meter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metering/attestation-meter")>();
  return { ...actual, meterAttestation };
});

vi.mock("@/lib/operator", () => ({
  recordCapabilityEvent,
}));

import {
  authorizeAgentSpend,
  createSpendScope,
  computeSpendScopeDigest,
  settleExternalRailPayment,
  railSignature,
  getAgentWallet,
} from "@/lib/agent-pay/agent-payment-service";

describe("Agentic Payments (agent wallets, scoped spend, external rails)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENTIC_PAY_RAIL_SECRET;
  });

  it("creates a merchant-bound, expiring spend scope with a digest", () => {
    const scope = createSpendScope("portable_credential_issuance", 1);
    expect(scope.merchant).toBe("passport");
    expect(scope.product).toBe("portable_credential_issuance");
    expect(scope.nonce).toMatch(/^[0-9a-f]{48}$/i);
    expect(new Date(scope.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(computeSpendScopeDigest(scope)).toMatch(/^[0-9a-f]{64}$/i);
  });

  it("rejects spend scope where merchant is not passport", async () => {
    const scope = createSpendScope("portable_credential_issuance", 5);
    scope.merchant = "evil-shop";
    const result = await authorizeAgentSpend({ operatorId: "op_1", product: "portable_credential_issuance", scope });
    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/merchant/);
  });

  it("rejects spend scope that exceeds the ceiling", async () => {
    const scope = createSpendScope("portable_credential_issuance", 0);
    const result = await authorizeAgentSpend({ operatorId: "op_1", product: "portable_credential_issuance", scope });
    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/ceiling|exceeds/);
  });

  it("authorizes a scoped spend and returns a payment digest", async () => {
    meterAttestation.mockResolvedValue({
      allowed: true,
      product: "portable_credential_issuance",
      price_micros: 500_000,
      credits_charged: 1,
      remaining_credits: 9,
      meter_ref: "meter_pay_1",
    });
    const scope = createSpendScope("portable_credential_issuance", 5);
    const result = await authorizeAgentSpend({ operatorId: "op_1", product: "portable_credential_issuance", scope });
    expect(result.authorized).toBe(true);
    expect(result.payment_digest).toMatch(/^[0-9a-f]{64}$/i);
    expect(meterAttestation).toHaveBeenCalled();
  });

  it("verifies an agent's Ed25519 signature over the scope digest (proof of possession)", async () => {
    meterAttestation.mockResolvedValue({ allowed: true, credits_charged: 1, remaining_credits: 9, meter_ref: "m1" });
    const privKey = hexToBytes("1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff");
    const pubKey = bytesToHex(await getPublicKey(privKey));
    const scope = createSpendScope("portable_credential_issuance", 5);
    const digest = computeSpendScopeDigest(scope);
    const sig = bytesToHex(await sign(utf8ToBytes(digest), privKey));

    const result = await authorizeAgentSpend({
      operatorId: "op_1",
      product: "portable_credential_issuance",
      scope,
      agentSignatureHex: sig,
      agentPublicKeyHex: pubKey,
    });
    expect(result.authorized).toBe(true);
  });

  it("rejects a forged agent signature", async () => {
    const scope = createSpendScope("portable_credential_issuance", 5);
    const result = await authorizeAgentSpend({
      operatorId: "op_1",
      product: "portable_credential_issuance",
      scope,
      agentSignatureHex: "f".repeat(128),
      agentPublicKeyHex: "a".repeat(64),
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/signature/);
  });

  it("rejects external settlement when rail secret is unset", async () => {
    const result = await settleExternalRailPayment({
      operatorId: "op_1",
      rail: "x402",
      reference: "ref-1",
      credit_credits: 10,
      signature: "x",
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/not configured/);
  });

  it("accepts an HMAC-authenticated external-rail settlement idempotently", async () => {
    process.env.AGENTIC_PAY_RAIL_SECRET = "rail-secret";
    prismaMock.capabilityLedgerEntry.findFirst.mockResolvedValue(null);
    prismaMock.capabilityLedgerEntry.create.mockResolvedValue({ id: "l1" });
    prismaMock.operator.findUnique.mockResolvedValue({ credits: 15 });

    const sig = railSignature("ref-xyz", 10, "stripe_agent", "rail-secret");

    const result = await settleExternalRailPayment({
      operatorId: "op_1",
      rail: "stripe_agent",
      reference: "ref-xyz",
      credit_credits: 10,
      signature: sig,
    });
    expect(result.accepted).toBe(true);
    expect(result.new_balance).toBe(15);
  });

  it("rejects a duplicate external settlement reference (unique constraint)", async () => {
    process.env.AGENTIC_PAY_RAIL_SECRET = "rail-secret";
    prismaMock.externalSettlement.create.mockRejectedValue({ code: "P2002" });
    const sig = railSignature("ref-dup", 5, "x402", "rail-secret");
    const result = await settleExternalRailPayment({
      operatorId: "op_1",
      rail: "x402",
      reference: "ref-dup",
      credit_credits: 5,
      signature: sig,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/Duplicate|already applied/i);
  });

  it("rejects a tampered rail signature", async () => {
    process.env.AGENTIC_PAY_RAIL_SECRET = "rail-secret";
    const result = await settleExternalRailPayment({
      operatorId: "op_1",
      rail: "mastercard_agent_pay",
      reference: "ref-1",
      credit_credits: 5,
      signature: "deadbeef",
    });
    expect(result.accepted).toBe(false);
  });

  it("reads the wallet balance", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ credits: 42 });
    const wallet = await getAgentWallet("op_1");
    expect(wallet.credits).toBe(42);
  });
});

async function authorizeAgentCredentialProduct(
  opts: Parameters<typeof import("@/lib/agent-pay/agent-payment-service").authorizeAgentSpend>[0]
) {
  return authorizeAgentSpend(opts);
}