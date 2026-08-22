import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operator: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    capabilityLedgerEntry: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
      return fn(prismaMock);
    }),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { decrementCredits, recordCapabilityEvent } = vi.hoisted(() => ({
  decrementCredits: vi.fn(async () => true),
  recordCapabilityEvent: vi.fn(async () => ({})),
}));

vi.mock("@/lib/operator", () => ({
  decrementCredits,
  recordCapabilityEvent,
}));

import {
  ATTESTATION_CATALOG,
  microsToCredits,
  meterAttestation,
  getOperatorCreditBalance,
} from "@/lib/metering/attestation-meter";

describe("Reputation-as-a-Service Metering (2.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  });

  it("defines a priced, labeled attestation product catalog", () => {
    expect(ATTESTATION_CATALOG.reputation_lookup_verified.price_micros).toBe(100_000);
    expect(ATTESTATION_CATALOG.portable_credential_issuance.price_micros).toBe(500_000);
    expect(ATTESTATION_CATALOG.audit_package_generation.price_micros).toBe(1_000_000);
    expect(ATTESTATION_CATALOG.neutrality_residency_attestation.price_micros).toBe(5_000_000);
    expect(microsToCredits(1_000_000)).toBe(1);
  });

  it("meters a portable credential issuance atomically and debits credits", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ credits: 100 });
    prismaMock.capabilityLedgerEntry.create.mockResolvedValue({ id: "ledger_1" });
    prismaMock.operator.update.mockResolvedValue({ credits: 99 });

    const result = await meterAttestation(
      "op_1",
      "portable_credential_issuance",
      "commitment123"
    );

    expect(result.allowed).toBe(true);
    expect(result.price_micros).toBe(500_000);
    expect(result.credits_charged).toBe(1); // fractional prices round UP to 1 whole credit
    expect(prismaMock.operator.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ credits: { decrement: 1 } }) })
    );
    expect(prismaMock.capabilityLedgerEntry.create).toHaveBeenCalled();
  });

  it("refuses when the operator has insufficient credit balance", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ credits: 0 });

    const result = await meterAttestation("op_1", "audit_package_generation");

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Insufficient credits/i);
    expect(result.credits_charged).toBe(0);
    expect(prismaMock.operator.update).not.toHaveBeenCalled();
  });

  it("reports the current credit balance", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ credits: 42 });
    const balance = await getOperatorCreditBalance("op_1");
    expect(balance).toBe(42);
  });
});
