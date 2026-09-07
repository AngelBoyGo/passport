import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    transitShipment: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    customsCheckpoint: { findUnique: vi.fn(), update: vi.fn() },
    borderTaxSettlement: { create: vi.fn(), findMany: vi.fn() },
    agentWallet: { upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  customsWalletCommitment,
  corridorInfrastructurePoolCommitment,
  computeTransitTariffAngel,
  splitTariffWaterfall,
  registerTransitShipment,
  verifyCheckpointPassage,
  buildCheckpointTrustPayload,
  TRANSIT_TARIFF_BPS,
  ANGEL_USD_PEG,
  STABILIZATION_TREASURY,
} from "../customs-clearing";
import { sign, getPublicKey } from "@noble/ed25519";
import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const escortSeed = hexToBytes(
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
);
const inspectorSeed = hexToBytes(
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);

const escortPublicKey = bytesToHex(getPublicKey(escortSeed));
const inspectorPublicKey = bytesToHex(getPublicKey(inspectorSeed));
const SEAL = "d".repeat(64);
const TIMESTAMP = "2026-09-08T12:00:00.000Z";

const setEnv = (key: string, value: string) => {
  (process.env as Record<string, string>)[key] = value;
};

const shipment = {
  id: "s_1",
  shipmentId: "SHIP-AES-LOME-2026-0001",
  manifestNumber: "MANIFEST-001",
  commodityType: "GOLD",
  fineUnits: 2000,
  originJurisdiction: "ML",
  destinationJurisdiction: "TG",
  routeCode: "CORRIDOR-BAMAKO-LOME",
  escortPublicKey,
  containerSealDigest: SEAL,
  status: "IN_TRANSIT",
  checkpointsCleared: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const checkpoint = {
  id: "c_1",
  checkpointCode: "CP-SIKASSO-ML",
  checkpointName: "Sikasso Checkpoint",
  jurisdiction: "ML",
  inspectorPublicKey,
  activeStatus: "ACTIVE",
  totalFeesCollectedAngel: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const trustPayload = buildCheckpointTrustPayload(
  shipment.shipmentId,
  checkpoint.checkpointCode,
  SEAL,
  TIMESTAMP
);

describe("Automated Diplomatic Transit Customs Clearing & Corridor Settlement (Phase 16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("wallet commitments", () => {
    it("derives deterministic 64-hex customs authority commitments", () => {
      const commitment = customsWalletCommitment("ML");
      expect(commitment).toMatch(/^[0-9a-f]{64}$/);
      expect(commitment).toBe(customsWalletCommitment("ml")); // case-insensitive jurisdiction
      expect(customsWalletCommitment("ML")).not.toBe(customsWalletCommitment("BF"));
      expect(customsWalletCommitment("ML")).not.toBe(SEAL);
    });

    it("derives a deterministic 64-hex corridor infrastructure pool commitment", () => {
      const commitment = corridorInfrastructurePoolCommitment();
      expect(commitment).toMatch(/^[0-9a-f]{64}$/);
      expect(commitment).toBe(corridorInfrastructurePoolCommitment());
    });
  });

  describe("computeTransitTariffAngel & splitTariffWaterfall (Exact-Allocation Invariant)", () => {
    it("charges 0.75% of gross USD value converted at 1 ANGEL = $5.00", () => {
      // 2,000g Au @ $75/g = $150,000 → 0.75% = $1,125 → /5 = 225 ANGEL
      expect(TRANSIT_TARIFF_BPS).toBe(75);
      expect(ANGEL_USD_PEG).toBe(5.0);
      expect(computeTransitTariffAngel(150_000)).toBe(225);
    });

    it("enforces a minimum 1 ANGEL tariff and zero fee for non-positive value", () => {
      expect(computeTransitTariffAngel(1)).toBe(1);
      expect(computeTransitTariffAngel(0)).toBe(0);
      expect(computeTransitTariffAngel(-50)).toBe(0);
    });

    it("splits tariff into exact 70/20/10 shares that sum to the tariff", () => {
      const waterfall = splitTariffWaterfall(225);
      expect(waterfall).toEqual({ hostCustomsAngel: 158, corridorPoolAngel: 45, treasuryAngel: 22 });
      expect(waterfall.hostCustomsAngel + waterfall.corridorPoolAngel + waterfall.treasuryAngel).toBe(225);
    });

    it("never leaks or over-credits on small tariffs", () => {
      for (const tariff of [1, 2, 7, 10, 250, 5000]) {
        const w = splitTariffWaterfall(tariff);
        expect(w.hostCustomsAngel + w.corridorPoolAngel + w.treasuryAngel).toBe(tariff);
      }
      expect(splitTariffWaterfall(1)).toEqual({ hostCustomsAngel: 1, corridorPoolAngel: 0, treasuryAngel: 0 });
    });
  });

  describe("registerTransitShipment", () => {
    it("rejects non-hex container seal digest", async () => {
      await expect(
        registerTransitShipment({
          shipmentId: "SHIP-X",
          manifestNumber: "M-X",
          commodityType: "GOLD",
          fineUnits: 100,
          originJurisdiction: "ML",
          destinationJurisdiction: "TG",
          routeCode: "R",
          escortPublicKey,
          containerSealDigest: "not-a-digest",
        })
      ).rejects.toThrow(/container seal digest/i);
    });

    it("rejects invalid escort public key", async () => {
      await expect(
        registerTransitShipment({
          shipmentId: "SHIP-X",
          manifestNumber: "M-X",
          commodityType: "GOLD",
          fineUnits: 100,
          originJurisdiction: "ML",
          destinationJurisdiction: "TG",
          routeCode: "R",
          escortPublicKey: "short",
          containerSealDigest: SEAL,
        })
      ).rejects.toThrow(/escort officer public key/i);
    });

    it("creates an IN_TRANSIT shipment on valid input", async () => {
      prismaMock.transitShipment.create.mockResolvedValue({
        shipmentId: "SHIP-AES-LOME-2026-0001",
        status: "IN_TRANSIT",
      });

      const created = await registerTransitShipment({
        shipmentId: "SHIP-AES-LOME-2026-0001",
        manifestNumber: "MANIFEST-001",
        commodityType: "GOLD",
        fineUnits: 2000,
        originJurisdiction: "ML",
        destinationJurisdiction: "TG",
        routeCode: "CORRIDOR-BAMAKO-LOME",
        escortPublicKey,
        containerSealDigest: SEAL,
      });

      expect(created.status).toBe("IN_TRANSIT");
      expect(prismaMock.transitShipment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            containerSealDigest: SEAL,
            status: "IN_TRANSIT",
            checkpointsCleared: [],
          }),
        })
      );
    });
  });

  describe("verifyCheckpointPassage", () => {
    const escortSignature = bytesToHex(sign(utf8ToBytes(trustPayload), escortSeed));
    const inspectorSignature = bytesToHex(sign(utf8ToBytes(trustPayload), inspectorSeed));

    const mockHappyPath = () => {
      prismaMock.transitShipment.findUnique.mockResolvedValue({ ...shipment });
      prismaMock.customsCheckpoint.findUnique.mockResolvedValue({ ...checkpoint });
      prismaMock.transitShipment.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.customsCheckpoint.update.mockResolvedValue({});
      prismaMock.borderTaxSettlement.create.mockResolvedValue({
        settlementId: "SETTLE-SHIP-AES-LOME-2026-0001-CP-SIKASSO-ML",
        checkpointId: checkpoint.id,
        shipmentId: shipment.id,
        tariffAngel: 225,
        hostCustomsAngel: 158,
        corridorPoolAngel: 45,
        treasuryAngel: 22,
        tariffRateBps: 75,
        clearedAt: new Date(),
      });
    };

    it("clears the checkpoint and settles the 70/20/10 waterfall on dual valid signatures", async () => {
      mockHappyPath();

      const result = await verifyCheckpointPassage({
        shipmentId: shipment.shipmentId,
        checkpointCode: checkpoint.checkpointCode,
        containerSealDigest: SEAL,
        timestampIso: TIMESTAMP,
        escortSignature,
        inspectorSignature,
      });

      expect(result.shipment.status).toBe("CHECKPOINT_CLEARED");
      expect(result.waterfall.grossValueUsd).toBe(150_000);
      expect(result.waterfall.tariffAngel).toBe(225);
      expect(result.waterfall).toEqual({
        grossValueUsd: 150_000,
        tariffAngel: 225,
        hostCustomsAngel: 158,
        corridorPoolAngel: 45,
        treasuryAngel: 22,
      });

      // TOCTOU-safe IN_TRANSIT -> CHECKPOINT_CLEARED transition
      expect(prismaMock.transitShipment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "s_1", status: "IN_TRANSIT" }),
        })
      );

      // 70% to deterministic host jurisdiction customs wallet
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment: customsWalletCommitment("ML"),
          }),
          update: expect.objectContaining({ balance: { increment: 158 } }),
        })
      );
      // 20% to corridor infrastructure pool
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment: corridorInfrastructurePoolCommitment(),
          }),
          update: expect.objectContaining({ balance: { increment: 45 } }),
        })
      );
      // 10% to stabilization treasury
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment: STABILIZATION_TREASURY,
          }),
          update: expect.objectContaining({ balance: { increment: 22 } }),
        })
      );
    });

    it("rejects a shipment that is not in IN_TRANSIT state", async () => {
      prismaMock.transitShipment.findUnique.mockResolvedValue({
        ...shipment,
        status: "CHECKPOINT_CLEARED",
      });
      prismaMock.customsCheckpoint.findUnique.mockResolvedValue({ ...checkpoint });

      await expect(
        verifyCheckpointPassage({
          shipmentId: shipment.shipmentId,
          checkpointCode: checkpoint.checkpointCode,
          containerSealDigest: SEAL,
          timestampIso: TIMESTAMP,
          escortSignature,
          inspectorSignature,
        })
      ).rejects.toThrow(/not in transit/i);
    });

    it("rejects a checkpoint that was already cleared (replay guard)", async () => {
      prismaMock.transitShipment.findUnique.mockResolvedValue({
        ...shipment,
        checkpointsCleared: ["CP-SIKASSO-ML"],
      });
      prismaMock.customsCheckpoint.findUnique.mockResolvedValue({ ...checkpoint });

      await expect(
        verifyCheckpointPassage({
          shipmentId: shipment.shipmentId,
          checkpointCode: checkpoint.checkpointCode,
          containerSealDigest: SEAL,
          timestampIso: TIMESTAMP,
          escortSignature,
          inspectorSignature,
        })
      ).rejects.toThrow(/already cleared/i);
    });

    it("rejects broken container seal hash as suspected tamper (always enforced)", async () => {
      prismaMock.transitShipment.findUnique.mockResolvedValue({ ...shipment });
      prismaMock.customsCheckpoint.findUnique.mockResolvedValue({ ...checkpoint });

      await expect(
        verifyCheckpointPassage({
          shipmentId: shipment.shipmentId,
          checkpointCode: checkpoint.checkpointCode,
          containerSealDigest: "0".repeat(64), // tampered seal
          timestampIso: TIMESTAMP,
          escortSignature,
          inspectorSignature,
        })
      ).rejects.toThrow(/seal digest mismatch.*tamper/i);

      // No settlement side effect on tamper
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("aborts the atomic clearing when the TOCTOU-guarded transition hits 0 rows", async () => {
      mockHappyPath();
      prismaMock.transitShipment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        verifyCheckpointPassage({
          shipmentId: shipment.shipmentId,
          checkpointCode: checkpoint.checkpointCode,
          containerSealDigest: SEAL,
          timestampIso: TIMESTAMP,
          escortSignature,
          inspectorSignature,
        })
      ).rejects.toThrow(/no longer in IN_TRANSIT/);
    });

    it("rejects an invalid customs inspector signature in production", async () => {
      mockHappyPath();
      const prev = process.env.NODE_ENV;
      setEnv("NODE_ENV", "production");
      try {
        const forgedInspector = bytesToHex(
          sign(utf8ToBytes(trustPayload + "tamper"), inspectorSeed)
        );
        await expect(
          verifyCheckpointPassage({
            shipmentId: shipment.shipmentId,
            checkpointCode: checkpoint.checkpointCode,
            containerSealDigest: SEAL,
            timestampIso: TIMESTAMP,
            escortSignature,
            inspectorSignature: forgedInspector,
          })
        ).rejects.toThrow(/Invalid customs inspector/);
      } finally {
        setEnv("NODE_ENV", prev ?? "");
      }
    });

    it("rejects an invalid escort officer signature in production", async () => {
      mockHappyPath();
      const prev = process.env.NODE_ENV;
      setEnv("NODE_ENV", "production");
      try {
        const forgedEscort = bytesToHex(sign(utf8ToBytes(trustPayload + "tamper"), escortSeed));
        await expect(
          verifyCheckpointPassage({
            shipmentId: shipment.shipmentId,
            checkpointCode: checkpoint.checkpointCode,
            containerSealDigest: SEAL,
            timestampIso: TIMESTAMP,
            escortSignature: forgedEscort,
            inspectorSignature,
          })
        ).rejects.toThrow(/Invalid escort officer/);
      } finally {
        setEnv("NODE_ENV", prev ?? "");
      }
    });
  });
});