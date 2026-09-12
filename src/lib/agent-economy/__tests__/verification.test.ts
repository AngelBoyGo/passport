import { describe, it, expect, vi, beforeEach } from "vitest";
import { keygen, sign } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    computePurchase: { findUnique: vi.fn(), updateMany: vi.fn() },
    agentWallet: { findUnique: vi.fn() },
    agentEnrollment: { findUnique: vi.fn() },
    computeOffer: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../spend-policy-service", () => ({ checkSpendPolicy: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/reputation/agent-reputation", () => ({ computeReputationBatch: vi.fn(async () => new Map()) }));

import { verifyDelivery, releaseCompute, refundCompute, canonicalDeliveryVerdict } from "../compute-marketplace";

const kp = keygen();
const BUYER = "a".repeat(64);
const PROVIDER = "b".repeat(64);
const VERIFIER = "c".repeat(64);
const DIGEST = "d".repeat(64);
const PUB = bytesToHex(kp.publicKey);

function purchase(overrides: Record<string, unknown> = {}) {
  return {
    purchaseId: "p1",
    offerId: "gpu-hours",
    buyerCommitment: BUYER,
    providerCommitment: PROVIDER,
    units: 3,
    totalAngel: 30,
    status: "DELIVERED",
    deliverableDigest: DIGEST,
    verificationVerdict: null,
    ...overrides,
  };
}

function signedVerdict(verdict: "APPROVE" | "REJECT") {
  return bytesToHex(sign(utf8ToBytes(canonicalDeliveryVerdict({ purchaseId: "p1", deliverableDigest: DIGEST, verdict })), kp.secretKey));
}

describe("on-delivery verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.computePurchase.findUnique.mockResolvedValue(purchase());
    prismaMock.computePurchase.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.agentWallet.findUnique.mockResolvedValue({ staked: 100 });
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({ publicKey: PUB, status: "ISSUED" });
  });

  it("records a staked, independent verifier's signed APPROVE", async () => {
    const r = await verifyDelivery({ purchaseId: "p1", verifierCommitment: VERIFIER, verdict: "APPROVE", signature: signedVerdict("APPROVE") });
    expect(r).toMatchObject({ ok: true, status: "APPROVE" });
    expect(prismaMock.computePurchase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { verifierCommitment: VERIFIER, verificationVerdict: "APPROVE" } })
    );
  });

  it("rejects a non-staked verifier, a party, and a bad signature", async () => {
    prismaMock.agentWallet.findUnique.mockResolvedValue({ staked: 0 });
    expect(await verifyDelivery({ purchaseId: "p1", verifierCommitment: VERIFIER, verdict: "APPROVE", signature: signedVerdict("APPROVE") })).toMatchObject({ ok: false, code: "not_staked" });

    prismaMock.agentWallet.findUnique.mockResolvedValue({ staked: 100 });
    expect(await verifyDelivery({ purchaseId: "p1", verifierCommitment: BUYER, verdict: "APPROVE", signature: signedVerdict("APPROVE") })).toMatchObject({ ok: false, code: "not_independent" });

    expect(await verifyDelivery({ purchaseId: "p1", verifierCommitment: VERIFIER, verdict: "APPROVE", signature: "a".repeat(128) })).toMatchObject({ ok: false, code: "invalid_signature" });
  });

  it("blocks release on REJECT and refund on APPROVE (unless forced)", async () => {
    prismaMock.computePurchase.findUnique.mockResolvedValue(purchase({ verificationVerdict: "REJECT" }));
    expect(await releaseCompute({ purchaseId: "p1", actorCommitment: BUYER, isIssuer: false })).toMatchObject({ ok: false, code: "verification_rejected" });

    prismaMock.computePurchase.findUnique.mockResolvedValue(purchase({ verificationVerdict: "APPROVE" }));
    expect(await refundCompute({ purchaseId: "p1", actorCommitment: BUYER, isIssuer: false })).toMatchObject({ ok: false, code: "verification_approved" });

    // force (arbitration) overrides
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
      fn({ computePurchase: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, agentWallet: { upsert: vi.fn() }, computeOffer: { update: vi.fn() } })
    );
    expect(await refundCompute({ purchaseId: "p1", actorCommitment: BUYER, isIssuer: true, force: true })).toMatchObject({ ok: true, status: "REFUNDED" });
  });
});
