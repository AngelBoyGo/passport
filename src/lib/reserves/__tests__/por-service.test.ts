import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VaultBatch, CommodityReserve, CommodityEscrow } from "@prisma/client";
import {
  computeBatchLeafHash,
  buildReserveMerkleTree,
  verifyInclusionProof,
  signPoRAttestation,
  verifyPoRAttestation,
  generateLivePoR,
  getBatchInclusionProof,
  type VaultBatchData,
} from "../por-service";
import { prisma } from "@/lib/db";

const mockBatches: VaultBatchData[] = [
  {
    batchNumber: "BKO-AU-2026-001",
    vaultId: "VAULT-BKO-CENTRAL",
    custodianName: "Banque Nationale de Développement / SOREM",
    locationCity: "Bamako",
    locationCountry: "ML",
    barSerials: ["ML-2026-001A", "ML-2026-001B"],
    grossWeightGrams: 25000.0,
    fineness: 0.9999,
    fineWeightGrams: 24997.5,
    status: "AUDITED",
    assayRef: "ASSAY-BKO-001",
  },
  {
    batchNumber: "OUA-AU-2026-002",
    vaultId: "VAULT-OUA-RESERVE",
    custodianName: "SONAMIG Bullion Vault",
    locationCity: "Ouagadougou",
    locationCountry: "BF",
    barSerials: ["BF-2026-101", "BF-2026-102", "BF-2026-103"],
    grossWeightGrams: 30000.0,
    fineness: 0.9950,
    fineWeightGrams: 29850.0,
    status: "AUDITED",
    assayRef: "ASSAY-OUA-102",
  },
  {
    batchNumber: "NIM-AU-2026-003",
    vaultId: "VAULT-NIM-SOPAMIN",
    custodianName: "SOPAMIN Secured Vault",
    locationCity: "Niamey",
    locationCountry: "NE",
    barSerials: ["NE-2026-501"],
    grossWeightGrams: 12500.0,
    fineness: 0.9990,
    fineWeightGrams: 12487.5,
    status: "AUDITED",
    assayRef: "ASSAY-NIM-501",
  },
];

describe("Proof-of-Reserves (PoR) Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("computeBatchLeafHash", () => {
    it("computes a deterministic 64-character SHA-256 hex string", () => {
      const hash1 = computeBatchLeafHash(mockBatches[0]);
      const hash2 = computeBatchLeafHash({ ...mockBatches[0] });

      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash1).toBe(hash2);
    });

    it("changes hash if purity, weight, or bar serials change", () => {
      const original = computeBatchLeafHash(mockBatches[0]);
      const modifiedWeight = computeBatchLeafHash({
        ...mockBatches[0],
        grossWeightGrams: 25001.0,
      });
      const modifiedFineness = computeBatchLeafHash({
        ...mockBatches[0],
        fineness: 0.9995,
      });
      const modifiedSerial = computeBatchLeafHash({
        ...mockBatches[0],
        barSerials: ["ML-2026-001A", "ML-2026-001X"],
      });

      expect(original).not.toBe(modifiedWeight);
      expect(original).not.toBe(modifiedFineness);
      expect(original).not.toBe(modifiedSerial);
    });

    it("sorts bar serials deterministically regardless of input order", () => {
      const batchA = { ...mockBatches[0], barSerials: ["Z-1", "A-2", "M-3"] };
      const batchB = { ...mockBatches[0], barSerials: ["A-2", "M-3", "Z-1"] };

      expect(computeBatchLeafHash(batchA)).toBe(computeBatchLeafHash(batchB));
    });
  });

  describe("buildReserveMerkleTree", () => {
    it("handles empty active batch list with 64 zero root", () => {
      const tree = buildReserveMerkleTree([]);
      expect(tree.root).toBe("0".repeat(64));
      expect(tree.leaves).toHaveLength(0);
      expect(tree.proofs.size).toBe(0);
    });

    it("handles single batch as root with empty proof path", () => {
      const tree = buildReserveMerkleTree([mockBatches[0]]);
      expect(tree.leaves).toHaveLength(1);
      expect(tree.root).toBe(tree.leaves[0].leafHash);
      expect(tree.proofs.get(mockBatches[0].batchNumber)).toEqual([]);

      const verified = verifyInclusionProof(
        tree.leaves[0].leafHash,
        tree.proofs.get(mockBatches[0].batchNumber)!,
        tree.root
      );
      expect(verified).toBe(true);
    });

    it("builds a multi-leaf tree where every leaf has a valid inclusion proof", () => {
      const tree = buildReserveMerkleTree(mockBatches);
      expect(tree.leaves).toHaveLength(3);
      expect(tree.root).toMatch(/^[0-9a-f]{64}$/);

      for (const batch of mockBatches) {
        const proof = tree.proofs.get(batch.batchNumber);
        expect(proof).toBeDefined();
        const leafHash = computeBatchLeafHash(batch);
        const verified = verifyInclusionProof(leafHash, proof!, tree.root);
        expect(verified).toBe(true);
      }
    });

    it("strictly isolates QUARANTINED or UNVERIFIED batches from active tree", () => {
      const mixedBatches: VaultBatchData[] = [
        ...mockBatches,
        {
          batchNumber: "SUSPECT-001",
          vaultId: "VAULT-BKO",
          custodianName: "Quarantined Facility",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["BAD-001"],
          grossWeightGrams: 50000.0,
          fineness: 0.5000,
          fineWeightGrams: 25000.0,
          status: "QUARANTINED",
        },
        {
          batchNumber: "PENDING-002",
          vaultId: "VAULT-OUA",
          custodianName: "Holding Counter",
          locationCity: "Ouagadougou",
          locationCountry: "BF",
          barSerials: ["PENDING-1"],
          grossWeightGrams: 10000.0,
          fineness: 0.9990,
          fineWeightGrams: 9990.0,
          status: "UNVERIFIED",
        },
      ];

      const cleanTree = buildReserveMerkleTree(mockBatches);
      const mixedTree = buildReserveMerkleTree(mixedBatches);

      // The root should be IDENTICAL because quarantined/unverified lots are excluded
      expect(mixedTree.root).toBe(cleanTree.root);
      expect(mixedTree.leaves).toHaveLength(3);
      expect(mixedTree.proofs.has("SUSPECT-001")).toBe(false);
      expect(mixedTree.proofs.has("PENDING-002")).toBe(false);
    });
  });

  describe("verifyInclusionProof", () => {
    it("fails verification if leaf hash is altered", () => {
      const tree = buildReserveMerkleTree(mockBatches);
      const batch = mockBatches[0];
      const proof = tree.proofs.get(batch.batchNumber)!;
      const forgedLeafHash = "a".repeat(64);

      const verified = verifyInclusionProof(forgedLeafHash, proof, tree.root);
      expect(verified).toBe(false);
    });

    it("fails verification if proof step is altered", () => {
      const tree = buildReserveMerkleTree(mockBatches);
      const batch = mockBatches[0];
      const proof = tree.proofs.get(batch.batchNumber)!;
      const corruptedProof = proof.map((step) => ({
        ...step,
        hash: "f".repeat(64),
      }));

      const leafHash = computeBatchLeafHash(batch);
      const verified = verifyInclusionProof(leafHash, corruptedProof, tree.root);
      expect(verified).toBe(false);
    });

    it("fails verification against wrong Merkle root", () => {
      const tree = buildReserveMerkleTree(mockBatches);
      const batch = mockBatches[0];
      const proof = tree.proofs.get(batch.batchNumber)!;
      const leafHash = computeBatchLeafHash(batch);

      const verified = verifyInclusionProof(leafHash, proof, "e".repeat(64));
      expect(verified).toBe(false);
    });
  });

  describe("Attestation Signing & Verification", () => {
    it("signs and verifies an Ed25519 PoR attestation", async () => {
      const payload = {
        attestation_id: "por_gold_test_001",
        commodity_type: "GOLD",
        symbol: "Au",
        total_fine_grams: 67335.0,
        total_gross_grams: 67500.0,
        active_lots_count: 3,
        merkle_root: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        timestamp: "2026-09-05T12:00:00.000Z",
        disclaimer: "Valid for published register inclusion only.",
      };

      const signed = await signPoRAttestation(payload);
      expect(signed.signature).toBeTruthy();
      expect(signed.public_key).toBeTruthy();
      expect(signed.algorithm).toBe("ed25519");

      const isValid = await verifyPoRAttestation(signed);
      expect(isValid).toBe(true);
    });

    it("rejects attestation if payload fields are tampered", async () => {
      const payload = {
        attestation_id: "por_gold_test_002",
        commodity_type: "GOLD",
        symbol: "Au",
        total_fine_grams: 50000.0,
        total_gross_grams: 50000.0,
        active_lots_count: 2,
        merkle_root: "a".repeat(64),
        timestamp: "2026-09-05T12:00:00.000Z",
        disclaimer: "Valid for published register inclusion only.",
      };

      const signed = await signPoRAttestation(payload);
      // Tamper with total_fine_grams
      const tampered = { ...signed, total_fine_grams: 999999.0 };

      const isValid = await verifyPoRAttestation(tampered);
      expect(isValid).toBe(false);
    });
  });

  describe("Database Integration (generateLivePoR & getBatchInclusionProof)", () => {
    it("aggregates active lots and updates reserve record", async () => {
      vi.spyOn(prisma.vaultBatch, "findMany").mockResolvedValue([
        {
          id: "vb_1",
          batchNumber: "BKO-001",
          reserveId: "res_1",
          vaultId: "V-1",
          custodianName: "Custodian 1",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["S1"],
          grossWeightGrams: 1000,
          fineness: 0.9999,
          fineWeightGrams: 999.9,
          status: "AUDITED",
          assayRef: "A1",
          metadata: null,
          auditedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as unknown as VaultBatch[]);

      vi.spyOn(prisma.commodityEscrow, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.commodityReserve, "upsert").mockResolvedValue({
        id: "res_1",
        commodityType: "GOLD",
        symbol: "Au",
        totalGrams: 1000,
        totalFineGrams: 999.9,
        activeLotsCount: 1,
        latestMerkleRoot: "mockroot",
        lastAuditedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as CommodityReserve);

      const result = await generateLivePoR("GOLD");

      expect(result.reserve.commodityType).toBe("GOLD");
      expect(result.reserve.totalFineGrams).toBeCloseTo(999.9);
      expect(result.reserve.unencumberedFineGrams).toBeCloseTo(999.9);
      expect(result.reserve.encumberedFineGrams).toBe(0);
      expect(result.attestation.active_lots_count).toBe(1);
      expect(result.attestation.signature).toBeTruthy();
    });

    it("deducts active HELD escrow grams from unencumbered reserves", async () => {
      vi.spyOn(prisma.vaultBatch, "findMany").mockResolvedValue([
        {
          id: "vb_1",
          batchNumber: "BKO-001",
          reserveId: "res_1",
          vaultId: "V-1",
          custodianName: "Custodian 1",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["S1"],
          grossWeightGrams: 1000,
          fineness: 1.0,
          fineWeightGrams: 1000.0,
          status: "AUDITED",
          metadata: null,
          auditedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as unknown as VaultBatch[]);

      // 300g locked in active HELD escrows
      vi.spyOn(prisma.commodityEscrow, "findMany").mockResolvedValue([
        { fineGrams: 300.0 },
      ] as unknown as CommodityEscrow[]);

      vi.spyOn(prisma.commodityReserve, "upsert").mockResolvedValue({
        id: "res_1",
        commodityType: "GOLD",
        symbol: "Au",
        totalGrams: 1000,
        totalFineGrams: 1000.0,
        activeLotsCount: 1,
        latestMerkleRoot: "mockroot",
      } as unknown as CommodityReserve);

      const result = await generateLivePoR("GOLD");

      expect(result.reserve.totalFineGrams).toBe(1000.0);
      expect(result.reserve.encumberedFineGrams).toBe(300.0);
      expect(result.reserve.unencumberedFineGrams).toBe(700.0);
    });

    it("retrieves valid inclusion proof for an audited batch", async () => {
      const dbBatches = [
        {
          id: "vb_1",
          batchNumber: "BKO-001",
          reserveId: "res_1",
          vaultId: "V-1",
          custodianName: "Custodian 1",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["S1"],
          grossWeightGrams: 1000,
          fineness: 0.9999,
          fineWeightGrams: 999.9,
          status: "AUDITED",
          assayRef: "A1",
          metadata: null,
          auditedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "vb_2",
          batchNumber: "OUA-002",
          reserveId: "res_1",
          vaultId: "V-2",
          custodianName: "Custodian 2",
          locationCity: "Ouagadougou",
          locationCountry: "BF",
          barSerials: ["S2"],
          grossWeightGrams: 2000,
          fineness: 0.9990,
          fineWeightGrams: 1998.0,
          status: "AUDITED",
          assayRef: "A2",
          metadata: null,
          auditedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.spyOn(prisma.vaultBatch, "findMany").mockResolvedValue(dbBatches as unknown as VaultBatch[]);

      const proof = await getBatchInclusionProof("BKO-001", "GOLD");
      expect(proof).not.toBeNull();
      expect(proof?.batchNumber).toBe("BKO-001");
      expect(proof?.verified).toBe(true);
      expect(proof?.merkleRoot).toBeTruthy();
    });

    it("returns verified: false for a quarantined batch", async () => {
      const dbBatches = [
        {
          id: "vb_bad",
          batchNumber: "BAD-001",
          reserveId: "res_1",
          vaultId: "V-1",
          custodianName: "Custodian 1",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["SBAD"],
          grossWeightGrams: 500,
          fineness: 0.5000,
          fineWeightGrams: 250.0,
          status: "QUARANTINED",
          assayRef: null,
          metadata: null,
          auditedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.spyOn(prisma.vaultBatch, "findMany").mockResolvedValue(dbBatches as unknown as VaultBatch[]);

      const proof = await getBatchInclusionProof("BAD-001", "GOLD");
      expect(proof).not.toBeNull();
      expect(proof?.batchNumber).toBe("BAD-001");
      expect(proof?.verified).toBe(false);
    });
  });
});
