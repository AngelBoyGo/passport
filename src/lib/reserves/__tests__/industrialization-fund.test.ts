import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentWallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    sovereignIndustrialProject: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    stabilizationDisbursement: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  getStabilizationFundBalance,
  registerIndustrialProject,
  checkFundSolvencyCeiling,
  verifyMilestoneCompletion,
  stateStabilizationWalletCommitment,
  distributeMilestoneAmounts,
  STABILIZATION_COLD_BUFFER_PERCENT,
  STABILIZATION_TREASURY,
} from "../industrialization-fund";
import { sign, getPublicKey } from "@noble/ed25519";
import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "@/lib/receipt/canonical";

describe("Sovereign Industrialization & Counter-Cyclical Stabilization Fund", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("distributeMilestoneAmounts (Exact-Allocation Invariant)", () => {
    it("distributes milestones whose sum exactly equals allocatedAngel", () => {
      const amounts = distributeMilestoneAmounts(5000, 3);
      expect(amounts).toEqual([1666, 1666, 1668]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(5000);
    });

    it("handles small allocations with a single milestone", () => {
      const amounts = distributeMilestoneAmounts(7, 3);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(7);
    });
  });

  describe("getStabilizationFundBalance", () => {
    it("partitions balance into deployable capital and cold hibernation reserve", async () => {
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: STABILIZATION_TREASURY,
        balance: 100000,
      });

      const balance = await getStabilizationFundBalance();
      expect(balance.totalBalance).toBe(100000);
      expect(balance.coldHibernationReserve).toBe(25000); // 25% locked
      expect(balance.deployableBalance).toBe(75000); // 75% deployable
      expect(STABILIZATION_COLD_BUFFER_PERCENT).toBe(0.25);
    });

    it("returns zero balance when treasury wallet does not exist", async () => {
      prismaMock.agentWallet.findUnique.mockResolvedValue(null);
      const balance = await getStabilizationFundBalance();
      expect(balance.totalBalance).toBe(0);
      expect(balance.deployableBalance).toBe(0);
    });
  });

  describe("registerIndustrialProject", () => {
    it("rejects project category outside statutory whitelist", async () => {
      await expect(
        registerIndustrialProject({
          projectCode: "PROJ-X",
          projectName: "Crypto Casino",
          category: "UNDEFINED",
          countryCode: "ML",
          districtName: "Bamako",
          operatorCommitment: "o".repeat(64),
          allocatedAngel: 5000,
        })
      ).rejects.toThrow(/eligibility whitelist/);
    });

    it("rejects deployment exceeding deployable stabilization balance", async () => {
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: STABILIZATION_TREASURY,
        balance: 10000, // deployable = 7500
      });

      await expect(
        registerIndustrialProject({
          projectCode: "PROJ-IRR-ML-001",
          projectName: "Solar Irrigation",
          category: "WATER_IRRIGATION",
          countryCode: "ML",
          districtName: "Sikasso",
          operatorCommitment: "o".repeat(64),
          allocatedAngel: 9000, // > 7500 deployable
        })
      ).rejects.toThrow(/exceeds deployable stabilization balance/i);
    });

    it("debits treasury and creates funded project when allocation is valid", async () => {
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: STABILIZATION_TREASURY,
        balance: 100000, // deployable = 75000
      });
      prismaMock.agentWallet.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.sovereignIndustrialProject.create.mockResolvedValue({
        projectCode: "PROJ-IRR-ML-001",
        projectName: "Solar Irrigation",
        category: "WATER_IRRIGATION",
        countryCode: "ML",
        status: "FUNDED",
        allocatedAngel: 5000,
        totalMilestones: 3,
      });
      prismaMock.stabilizationDisbursement.create.mockResolvedValue({
        disbursementId: "DISB-PROJ-IRR-ML-001-M1",
        status: "PENDING",
      });

      const project = await registerIndustrialProject({
        projectCode: "PROJ-IRR-ML-001",
        projectName: "Solar Irrigation",
        category: "WATER_IRRIGATION",
        countryCode: "ML",
        districtName: "Sikasso",
        operatorCommitment: "o".repeat(64),
        allocatedAngel: 5000,
        totalMilestones: 3,
      });

      expect(project.status).toBe("FUNDED");
      // Treasury atomically debited only when balance >= allocation
      expect(prismaMock.agentWallet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment: STABILIZATION_TREASURY,
            balance: { gte: 5000 },
          }),
          data: expect.objectContaining({ balance: { decrement: 5000 } }),
        })
      );
    });
  });

  describe("checkFundSolvencyCeiling", () => {
    it("reports buffer solvent when deployment stays within 75% allocatable", async () => {
      prismaMock.agentWallet.findUnique.mockResolvedValue({
        subjectCommitment: STABILIZATION_TREASURY,
        balance: 100000,
      });
      prismaMock.sovereignIndustrialProject.findMany.mockResolvedValue([
        { allocatedAngel: 5000, status: "ACTIVE" },
      ]);
      prismaMock.stabilizationDisbursement.findMany.mockResolvedValue([
        { amountAngel: 2000 },
        { amountAngel: 2000 },
      ]);

      const solvency = await checkFundSolvencyCeiling();
      expect(solvency.totalBalance).toBe(100000);
      expect(solvency.coldHibernationReserve).toBe(25000);
      expect(solvency.bufferSolvent).toBe(true);
    });
  });

  describe("verifyMilestoneCompletion (Ed25519 credible neutral verifier)", () => {
    const verifierPrivateKey = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
    const verifierPublicKey = bytesToHex(getPublicKey(verifierPrivateKey));
    const mediaDigest = "d".repeat(64);

    it("rejects disbursement that is not in PENDING state", async () => {
      prismaMock.stabilizationDisbursement.findUnique.mockResolvedValue({
        disbursementId: "DISB-1",
        status: "PAID",
        milestoneNumber: 1,
        project: { projectCode: "PROJ-X" },
      });

      await expect(
        verifyMilestoneCompletion({
          disbursementId: "DISB-1",
          verifierSignature: "sig",
          verifierPublicKey: "pk",
          mediaDigest,
        })
      ).rejects.toThrow(/is not pending/i);
    });

    it("releases funds and advances milestone when verifier signature is valid and disbursement is PENDING", async () => {
      const payload = {
        disbursement_id: "DISB-PROJ-1",
        media_digest: mediaDigest,
        milestone_number: 1,
        project_code: "PROJ-1",
      };

      const canonicalPayload = canonicalJson(payload);
      const signatureBytes = await sign(utf8ToBytes(canonicalPayload), verifierPrivateKey);

      const pendingDisbursement = {
        disbursementId: "DISB-PROJ-1",
        milestoneNumber: 1,
        status: "PENDING",
        amountAngel: 500,
        projectId: "proj_1",
        project: { projectCode: "PROJ-1", countryCode: "ML", totalMilestones: 1 },
      };
      const paidDisbursement = {
        ...pendingDisbursement,
        status: "PAID",
        disbursedAt: new Date(),
      };

      prismaMock.stabilizationDisbursement.findUnique
        .mockResolvedValueOnce(pendingDisbursement)
        .mockResolvedValueOnce(paidDisbursement);
      prismaMock.stabilizationDisbursement.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.sovereignIndustrialProject.update.mockResolvedValue({
        id: "proj_1",
        completedMilestones: 1,
        totalMilestones: 1,
        allocatedAngel: 500,
        status: "COMPLETED",
        projectCode: "PROJ-1",
        countryCode: "ML",
        districtName: "Sikasso",
        projectName: "Solar Irrigation",
        category: "WATER_IRRIGATION",
        expectedJobs: 10,
        jobsCreated: 1,
        declaredImpactKwh: 1000,
        realizedImpactKwh: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await verifyMilestoneCompletion({
        disbursementId: "DISB-PROJ-1",
        verifierSignature: bytesToHex(signatureBytes),
        verifierPublicKey,
        mediaDigest,
      });

      expect(result.disbursement.status).toBe("PAID");
      expect(result.isComplete).toBe(true);
      // Atomic PENDING -> PAID transition used
      expect(prismaMock.stabilizationDisbursement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "PENDING" }),
        })
      );
      // Milestone amount credited to the deterministic 64-hex state stabilization wallet
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment: stateStabilizationWalletCommitment("ML"),
          }),
          update: expect.objectContaining({ balance: { increment: 500 } }),
        })
      );
    });

    it("rejects a verifier key that is not in MILESTONE_VERIFIER_KEYS", async () => {
      vi.stubEnv("ENFORCE_SIGNATURES", "1");
      vi.stubEnv("MILESTONE_VERIFIER_KEYS", "ab".repeat(32));
      try {
        prismaMock.stabilizationDisbursement.findUnique.mockResolvedValue({
          disbursementId: "DISB-PROJ-1",
          milestoneNumber: 1,
          status: "PENDING",
          amountAngel: 500,
          projectId: "proj_1",
          project: { projectCode: "PROJ-1", countryCode: "ML", totalMilestones: 1 },
        });

        await expect(
          verifyMilestoneCompletion({
            disbursementId: "DISB-PROJ-1",
            verifierSignature: "00".repeat(64),
            verifierPublicKey: "cd".repeat(32),
            mediaDigest,
          })
        ).rejects.toThrow(/not an authorized milestone verifier/);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("fails closed under enforcement when no verifier allowlist is configured", async () => {
      vi.stubEnv("ENFORCE_SIGNATURES", "1");
      delete process.env.MILESTONE_VERIFIER_KEYS;
      try {
        prismaMock.stabilizationDisbursement.findUnique.mockResolvedValue({
          disbursementId: "DISB-PROJ-1",
          milestoneNumber: 1,
          status: "PENDING",
          amountAngel: 500,
          projectId: "proj_1",
          project: { projectCode: "PROJ-1", countryCode: "ML", totalMilestones: 1 },
        });

        await expect(
          verifyMilestoneCompletion({
            disbursementId: "DISB-PROJ-1",
            verifierSignature: "00".repeat(64),
            verifierPublicKey: "cd".repeat(32),
            mediaDigest,
          })
        ).rejects.toThrow(/No authorized milestone verifier keys configured/);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});