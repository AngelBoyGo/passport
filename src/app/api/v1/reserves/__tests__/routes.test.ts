import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { VaultBatch, AssayerCertification } from "@prisma/client";
import { GET as getPoR } from "../por/route";
import { GET as getVaults } from "../vaults/route";
import { GET as getAssays, POST as postAssays } from "../assays/route";
import { prisma } from "@/lib/db";
import * as porService from "@/lib/reserves/por-service";

describe("Reserves API Endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/reserves/por", () => {
    it("returns live PoR attestation and active batches", async () => {
      vi.spyOn(porService, "generateLivePoR").mockResolvedValue({
        reserve: {
          commodityType: "GOLD",
          symbol: "Au",
          totalGrams: 50000,
          totalFineGrams: 49950,
          activeLotsCount: 2,
          merkleRoot: "mockroot123",
          lastAuditedAt: new Date("2026-09-05T12:00:00Z"),
        },
        attestation: {
          attestation_id: "por_gold_1",
          commodity_type: "GOLD",
          symbol: "Au",
          total_fine_grams: 49950,
          total_gross_grams: 50000,
          active_lots_count: 2,
          merkle_root: "mockroot123",
          timestamp: "2026-09-05T12:00:00.000Z",
          public_key: "pubkey",
          signature: "sig",
          algorithm: "ed25519",
          disclaimer: "Valid for published register inclusion only.",
        },
        batches: [
          {
            batchNumber: "BKO-01",
            vaultId: "V-BKO",
            custodianName: "SOREM Custody",
            locationCity: "Bamako",
            locationCountry: "ML",
            barSerials: ["S1", "S2"],
            grossWeightGrams: 25000,
            fineness: 0.999,
            fineWeightGrams: 24975,
            status: "AUDITED",
            assayRef: "A-1",
          },
        ],
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/por?commodity=GOLD");
      const res = await getPoR(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.reserve.commodity_type).toBe("GOLD");
      expect(data.reserve.total_fine_grams).toBe(49950);
      expect(data.batches).toHaveLength(1);
      expect(data.disclaimer).toBeTruthy();
    });

    it("returns inclusion proof when batch query param is provided", async () => {
      vi.spyOn(porService, "getBatchInclusionProof").mockResolvedValue({
        batchNumber: "BKO-01",
        leafHash: "leafhash123",
        merkleRoot: "roothash123",
        proof: [{ position: "right", hash: "siblinghash" }],
        verified: true,
      });

      const req = new NextRequest(
        "https://passport.metis.gold/api/v1/reserves/por?batch=BKO-01"
      );
      const res = await getPoR(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.batch_number).toBe("BKO-01");
      expect(data.verified).toBe(true);
      expect(data.proof).toHaveLength(1);
    });

    it("returns 404 when queried batch does not exist", async () => {
      vi.spyOn(porService, "getBatchInclusionProof").mockResolvedValue(null);

      const req = new NextRequest(
        "https://passport.metis.gold/api/v1/reserves/por?batch=NON-EXISTENT"
      );
      const res = await getPoR(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("NON-EXISTENT");
    });
  });

  describe("GET /api/v1/reserves/vaults", () => {
    it("aggregates active batches by vaultId", async () => {
      vi.spyOn(prisma.vaultBatch, "findMany").mockResolvedValue([
        {
          id: "vb_1",
          batchNumber: "BKO-1",
          reserveId: "res_1",
          vaultId: "VAULT-BKO",
          custodianName: "Banque Nationale",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["B1"],
          grossWeightGrams: 10000,
          fineness: 0.9999,
          fineWeightGrams: 9999,
          status: "AUDITED",
          assayRef: null,
          metadata: null,
          auditedAt: new Date("2026-09-01"),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "vb_2",
          batchNumber: "BKO-2",
          reserveId: "res_1",
          vaultId: "VAULT-BKO",
          custodianName: "Banque Nationale",
          locationCity: "Bamako",
          locationCountry: "ML",
          barSerials: ["B2"],
          grossWeightGrams: 15000,
          fineness: 0.9950,
          fineWeightGrams: 14925,
          status: "AUDITED",
          assayRef: null,
          metadata: null,
          auditedAt: new Date("2026-09-02"),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as unknown as VaultBatch[]);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/vaults");
      const res = await getVaults(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.total_vaults).toBe(1);
      expect(data.vaults[0].vault_id).toBe("VAULT-BKO");
      expect(data.vaults[0].active_batches_count).toBe(2);
      expect(data.vaults[0].total_fine_grams).toBeCloseTo(24924);
    });
  });

  describe("Assays API (GET & POST /api/v1/reserves/assays)", () => {
    it("lists recent assay certifications", async () => {
      vi.spyOn(prisma.assayerCertification, "findMany").mockResolvedValue([
        {
          id: "ac_1",
          certificationNumber: "CERT-001",
          batchNumber: "BKO-1",
          assayerName: "Bureau National des Mines",
          assayerPublicKey: "pk123",
          methodology: "XRF_SPECTROMETRY",
          purityFineness: 0.9995,
          grossGrams: 10000,
          sampleSignature: "sig123",
          notes: "Certified pure doré bar",
          certifiedAt: new Date("2026-09-04"),
          createdAt: new Date("2026-09-04"),
        },
      ] as unknown as AssayerCertification[]);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/assays");
      const res = await getAssays(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
      expect(data.assays[0].certification_number).toBe("CERT-001");
    });

    it("rejects POST with missing required fields", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/assays", {
        method: "POST",
        body: JSON.stringify({
          certification_number: "CERT-002",
        }),
      });

      const res = await postAssays(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing required fields");
    });

    it("records a valid assay certification", async () => {
      vi.spyOn(prisma.assayerCertification, "create").mockResolvedValue({
        id: "ac_2",
        certificationNumber: "CERT-002",
        batchNumber: "BKO-2",
        assayerName: "SOPAMIN Assayer",
        assayerPublicKey: "pk456",
        methodology: "XRF_SPECTROMETRY",
        purityFineness: 0.9999,
        grossGrams: 12500,
        sampleSignature: "sig456",
        notes: null,
        certifiedAt: new Date("2026-09-05"),
        createdAt: new Date("2026-09-05"),
      } as unknown as AssayerCertification);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/assays", {
        method: "POST",
        body: JSON.stringify({
          certification_number: "CERT-002",
          assayer_name: "SOPAMIN Assayer",
          assayer_public_key: "pk456",
          batch_number: "BKO-2",
          methodology: "XRF_SPECTROMETRY",
          purity_fineness: 0.9999,
          gross_grams: 12500,
          sample_signature: "sig456",
        }),
      });

      const res = await postAssays(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.certification.certification_number).toBe("CERT-002");
    });
  });
});
