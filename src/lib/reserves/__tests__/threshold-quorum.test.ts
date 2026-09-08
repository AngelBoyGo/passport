import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    sovereignQuorumProposal: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    quorumSignature: { create: vi.fn(), count: vi.fn() },
    vaultBatch: { create: vi.fn(), update: vi.fn() },
    commodityReserve: { upsert: vi.fn() },
    sovereignStateHeartbeat: { upsert: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  createQuorumProposal,
  submitQuorumSignature,
  registerStateHeartbeat,
  checkDeadManSurveillance,
} from "../threshold-quorum";
import * as porService from "../por-service";
import type { SovereignStateHeartbeat } from "@prisma/client";
import { sign, getPublicKey } from "@noble/ed25519";
import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

describe("Trilateral Multi-State Threshold Quorum & Governance", () => {
  // Deterministic mock test keypair for Mali (ML)
  const mlPrivateKey = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  const bfPrivateKey = "1112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f30";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("createQuorumProposal", () => {
    it("creates a PENDING proposal with canonical SHA-256 payload digest", async () => {
      prismaMock.sovereignQuorumProposal.create.mockResolvedValue({
        id: "prop_db_1",
        proposalId: "PROP-AES-001",
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        payloadDigest: "digest123",
        proposerState: "ML",
        requiredThreshold: 2,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      });

      const proposal = await createQuorumProposal({
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        proposerState: "ML",
      });

      expect(proposal.proposalId).toBe("PROP-AES-001");
      expect(proposal.status).toBe("PENDING");
      expect(prismaMock.sovereignQuorumProposal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "QUARANTINE_VAULT",
            proposerState: "ML",
            requiredThreshold: 2,
          }),
        })
      );
    });

    it("rejects invalid proposer nation codes", async () => {
      await expect(
        createQuorumProposal({
          actionType: "EMERGENCY_FREEZE",
          payload: {},
          proposerState: "US", // Invalid
        })
      ).rejects.toThrow(/Invalid proposer state/);
    });
  });

  describe("submitQuorumSignature", () => {
    const payloadDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    it("leaves proposal PENDING on 1-of-3 signature", async () => {
      // Sign payloadDigest with Mali private key
      const sigBytes = await sign(utf8ToBytes(payloadDigest), hexToBytes(mlPrivateKey));
      const mlSignature = bytesToHex(sigBytes);
      const mlPublicKey = bytesToHex(getPublicKey(hexToBytes(mlPrivateKey)));

      prismaMock.sovereignQuorumProposal.findUnique.mockResolvedValue({
        id: "prop_db_1",
        proposalId: "PROP-AES-001",
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        payloadDigest,
        requiredThreshold: 2,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      prismaMock.quorumSignature.create.mockResolvedValue({});
      prismaMock.quorumSignature.count.mockResolvedValue(1); // 1 vote < 2 threshold

      const result = await submitQuorumSignature({
        proposalId: "PROP-AES-001",
        signerState: "ML",
        signature: mlSignature,
        signerPublicKey: mlPublicKey,
      });

      expect(result.status).toBe("PENDING");
      expect(result.executed).toBe(false);
      expect(result.totalSignatures).toBe(1);
    });

    it("auto-executes action when 2-of-3 threshold is reached", async () => {
      const sigBytes = await sign(utf8ToBytes(payloadDigest), hexToBytes(bfPrivateKey));
      const bfSignature = bytesToHex(sigBytes);
      const bfPublicKey = bytesToHex(getPublicKey(hexToBytes(bfPrivateKey)));

      prismaMock.sovereignQuorumProposal.findUnique.mockResolvedValue({
        id: "prop_db_1",
        proposalId: "PROP-AES-001",
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        payloadDigest,
        requiredThreshold: 2,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      prismaMock.quorumSignature.create.mockResolvedValue({});
      prismaMock.quorumSignature.count.mockResolvedValue(2); // 2 votes == 2 threshold!
      prismaMock.sovereignQuorumProposal.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.vaultBatch.update.mockResolvedValue({});
      prismaMock.sovereignQuorumProposal.update.mockResolvedValue({});
      vi.spyOn(porService, "generateLivePoR").mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof porService.generateLivePoR>>
      );

      const result = await submitQuorumSignature({
        proposalId: "PROP-AES-001",
        signerState: "BF",
        signature: bfSignature,
        signerPublicKey: bfPublicKey,
      });

      expect(result.status).toBe("EXECUTED");
      expect(result.executed).toBe(true);
      expect(result.totalSignatures).toBe(2);
      expect(prismaMock.vaultBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { batchNumber: "BKO-01" },
          data: { status: "QUARANTINED" },
        })
      );
    });

    it("does not re-execute action if concurrent transaction already transitioned proposal", async () => {
      const sigBytes = await sign(utf8ToBytes(payloadDigest), hexToBytes(bfPrivateKey));
      const bfSignature = bytesToHex(sigBytes);
      const bfPublicKey = bytesToHex(getPublicKey(hexToBytes(bfPrivateKey)));

      prismaMock.sovereignQuorumProposal.findUnique.mockResolvedValue({
        id: "prop_db_1",
        proposalId: "PROP-AES-001",
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        payloadDigest,
        requiredThreshold: 2,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      prismaMock.quorumSignature.create.mockResolvedValue({});
      prismaMock.quorumSignature.count.mockResolvedValue(2);
      // Concurrent transaction already won the transition race:
      prismaMock.sovereignQuorumProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await submitQuorumSignature({
        proposalId: "PROP-AES-001",
        signerState: "BF",
        signature: bfSignature,
        signerPublicKey: bfPublicKey,
      });

      expect(result.status).toBe("EXECUTED");
      expect(result.executionResult).toBeNull();
      // Vault batch update was NOT re-executed
      expect(prismaMock.vaultBatch.update).not.toHaveBeenCalled();
    });

    it("rejects signature if proposal has expired", async () => {
      prismaMock.sovereignQuorumProposal.findUnique.mockResolvedValue({
        id: "prop_db_exp",
        proposalId: "PROP-EXPIRED",
        payloadDigest,
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1000), // Expired
      });

      await expect(
        submitQuorumSignature({
          proposalId: "PROP-EXPIRED",
          signerState: "ML",
          signature: "dummy_sig",
        })
      ).rejects.toThrow(/expired/);
    });

    it("rejects duplicate vote if sovereign state has already signed proposal", async () => {
      prismaMock.sovereignQuorumProposal.findUnique.mockResolvedValue({
        id: "prop_db_dup",
        proposalId: "PROP-DUP",
        payloadDigest,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 3600 * 1000),
        signatures: [{ signerState: "ML" }],
      });

      await expect(
        submitQuorumSignature({
          proposalId: "PROP-DUP",
          signerState: "ML",
          signature: "dummy_sig",
        })
      ).rejects.toThrow(/already signed/);
    });
  });

  describe("Dead-Man's Surveillance (Q179)", () => {
    it("flags DARK status if a state sentry node heartbeat exceeds 72h silence", async () => {
      prismaMock.sovereignStateHeartbeat.findMany.mockResolvedValue([
        {
          id: "hb_ml",
          countryCode: "ML",
          nodeEndpoint: "https://ml.sentry",
          lastSeenAt: new Date(), // Fresh
          heartbeatNonce: "n1",
          signature: "s1",
          status: "ONLINE",
          updatedAt: new Date(),
        },
        {
          id: "hb_bf",
          countryCode: "BF",
          nodeEndpoint: "https://bf.sentry",
          lastSeenAt: new Date(Date.now() - 80 * 3600 * 1000), // 80h silence > 72h
          heartbeatNonce: "n2",
          signature: "s2",
          status: "ONLINE",
          updatedAt: new Date(),
        },
      ] as unknown as SovereignStateHeartbeat[]);

      const report = await checkDeadManSurveillance(72);
      expect(report.isAnyStateDark).toBe(true);
      expect(report.deadManAlertTriggered).toBe(true);

      const bfState = report.states.find((s) => s.countryCode === "BF");
      expect(bfState?.status).toBe("DARK");
      expect(bfState?.silenceHours).toBeGreaterThan(72);
    });

    it("registers authenticated state heartbeat", async () => {
      prismaMock.sovereignStateHeartbeat.upsert.mockResolvedValue({
        id: "hb_ml",
        countryCode: "ML",
        nodeEndpoint: "https://ml.sentry.metis.gold",
        lastSeenAt: new Date(),
        heartbeatNonce: "nonce_123",
        signature: "sig_mock",
        status: "ONLINE",
        updatedAt: new Date(),
      } as unknown as SovereignStateHeartbeat);

      const hb = await registerStateHeartbeat({
        countryCode: "ML",
        nodeEndpoint: "https://ml.sentry.metis.gold",
        heartbeatNonce: "nonce_123",
        signature: "sig_mock",
      });

      expect(hb.status).toBe("ONLINE");
      expect(prismaMock.sovereignStateHeartbeat.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { countryCode: "ML" },
        })
      );
    });
  });
});
