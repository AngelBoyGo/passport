import { describe, it, expect, vi, beforeEach } from "vitest";
import { keygen, sign } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalVote } from "../dispute";

const { prismaMock, marketMock } = vi.hoisted(() => ({
  prismaMock: {
    computeDispute: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    computeDisputeVote: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    computePurchase: { findUnique: vi.fn() },
    agentWallet: { findUnique: vi.fn() },
    agentEnrollment: { findUnique: vi.fn() },
  },
  marketMock: { releaseCompute: vi.fn(), refundCompute: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../compute-marketplace", () => marketMock);

import { openDispute, castDisputeVote } from "../dispute";

const kp = keygen();
const BUYER = "a".repeat(64);
const PROVIDER = "b".repeat(64);
const JUROR = "c".repeat(64);
const PUB = bytesToHex(kp.publicKey);
const DISPUTE = "cd_1";

const purchase = {
  purchaseId: "p1",
  buyerCommitment: BUYER,
  providerCommitment: PROVIDER,
  status: "DELIVERED",
  totalAngel: 30,
  units: 3,
  offerId: "gpu-hours",
};

const dispute = { disputeId: DISPUTE, purchaseId: "p1", openedBy: BUYER, reason: "bad output", status: "OPEN" };

function voteSig(vote: "RELEASE" | "REFUND", juror = kp) {
  return bytesToHex(sign(utf8ToBytes(canonicalVote({ disputeId: DISPUTE, vote })), juror.secretKey));
}

describe("compute dispute arbitration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.computePurchase.findUnique.mockResolvedValue(purchase);
    prismaMock.computeDispute.findUnique.mockResolvedValue(dispute);
    prismaMock.agentWallet.findUnique.mockResolvedValue({ staked: 50 });
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({ publicKey: PUB, status: "ISSUED" });
    prismaMock.computeDisputeVote.create.mockResolvedValue({ id: "v1" });
    prismaMock.computeDisputeVote.count.mockResolvedValue(1);
    marketMock.releaseCompute.mockResolvedValue({ ok: true, purchaseId: "p1", status: "SETTLED" });
    marketMock.refundCompute.mockResolvedValue({ ok: true, purchaseId: "p1", status: "REFUNDED" });
  });

  describe("openDispute", () => {
    it("open by a party on a DELIVERED purchase", async () => {
      prismaMock.computeDispute.findFirst.mockResolvedValue(null);
      prismaMock.computeDispute.create.mockResolvedValue(dispute);
      const r = await openDispute({ disputeId: DISPUTE, purchaseId: "p1", openedBy: BUYER, reason: "bad output" });
      expect(r).toMatchObject({ ok: true, status: "OPEN" });
    });

    it("rejects non-parties and non-DELIVERED purchases", async () => {
      prismaMock.computeDispute.findFirst.mockResolvedValue(null);
      expect(await openDispute({ disputeId: "cd_x", purchaseId: "p1", openedBy: "d".repeat(64), reason: "nope" })).toMatchObject({ ok: false, code: "not_party" });

      prismaMock.computePurchase.findUnique.mockResolvedValue({ ...purchase, status: "HELD" });
      expect(await openDispute({ disputeId: "cd_x", purchaseId: "p1", openedBy: BUYER, reason: "nope" })).toMatchObject({ ok: false, code: "invalid_state" });
    });
  });

  describe("castDisputeVote", () => {
    it("rejects non-staked jurors and bad signatures", async () => {
      prismaMock.agentWallet.findUnique.mockResolvedValue({ staked: 0 });
      expect(await castDisputeVote({ disputeId: DISPUTE, jurorCommitment: JUROR, vote: "RELEASE", signature: voteSig("RELEASE") })).toMatchObject({ ok: false, code: "not_staked" });

      prismaMock.agentWallet.findUnique.mockResolvedValue({ staked: 50 });
      expect(await castDisputeVote({ disputeId: DISPUTE, jurorCommitment: JUROR, vote: "RELEASE", signature: "a".repeat(128) })).toMatchObject({ ok: false, code: "invalid_signature" });
    });

    it("records a vote and reports OPEN below quorum", async () => {
      prismaMock.computeDisputeVote.findMany.mockResolvedValue([{ vote: "RELEASE" }]);
      const r = await castDisputeVote({ disputeId: DISPUTE, jurorCommitment: JUROR, vote: "RELEASE", signature: voteSig("RELEASE") });
      expect(r).toMatchObject({ ok: true, status: "OPEN", votes: 1 });
    });

    it("resolves RELEASE on a majority at quorum", async () => {
      prismaMock.computeDisputeVote.findMany.mockResolvedValue([{ vote: "RELEASE", jurorCommitment: "j1" }, { vote: "RELEASE", jurorCommitment: "j2" }, { vote: "REFUND", jurorCommitment: "j3" }]);
      const r = await castDisputeVote({ disputeId: DISPUTE, jurorCommitment: JUROR, vote: "RELEASE", signature: voteSig("RELEASE") });
      expect(r).toMatchObject({ ok: true, status: "RESOLVED", resolution: "RELEASE" });
      const call = marketMock.releaseCompute.mock.calls[0][0];
      expect(call.force).toBe(true);
      // majority (2) rewarded from escrow; minority (1) slashed
      expect(call.settlement.jurorRewards).toHaveLength(2);
      expect(call.settlement.slashes).toEqual([{ commitment: "j3", amount: 1 }]);
    });

    it("resolves REFUND on a REFUND majority (ties default to REFUND)", async () => {
      prismaMock.computeDisputeVote.findMany.mockResolvedValue([{ vote: "RELEASE" }, { vote: "REFUND" }, { vote: "REFUND" }]);
      const r = await castDisputeVote({ disputeId: DISPUTE, jurorCommitment: JUROR, vote: "REFUND", signature: voteSig("REFUND") });
      expect(r).toMatchObject({ ok: true, resolution: "REFUND" });
      expect(marketMock.refundCompute).toHaveBeenCalled();
    });

    it("treats a duplicate vote (P2002) as idempotent", async () => {
      prismaMock.computeDisputeVote.create.mockRejectedValue(Object.assign(new Error("Unique"), { code: "P2002" }));
      prismaMock.computeDisputeVote.count.mockResolvedValue(2);
      const r = await castDisputeVote({ disputeId: DISPUTE, jurorCommitment: JUROR, vote: "RELEASE", signature: voteSig("RELEASE") });
      expect(r).toMatchObject({ ok: true, status: "OPEN", votes: 2 });
      expect(marketMock.releaseCompute).not.toHaveBeenCalled();
    });
  });
});
