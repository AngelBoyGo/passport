import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as postSmelt } from "../industrial/smelt/route";
import { POST as postBridge } from "../industrial/bridge/route";
import { GET as getConcessions } from "../industrial/concessions/route";
import * as industrial from "@/lib/reserves/industrial-mining";
import type { SmeltingRunTelemetry, VaultBatch } from "@prisma/client";

describe("Industrial Mining API Endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/reserves/industrial/smelt", () => {
    it("returns 201 with smelting telemetry and royalty", async () => {
      vi.spyOn(industrial, "recordSmeltingRun").mockResolvedValue({
        run: {
          runNumber: "SMELT-001",
          concessionCode: "CONC-ML-FEKOLA",
          grossPouredGrams: 5000.0,
          fineGoldGrams: 4400.0,
          fineSilverGrams: 400.0,
          grossMarketValueUsd: 330380.0,
          royaltyDueAngel: 6607,
          stateShareDueAngel: 13215,
          status: "POURED",
          pouredAt: new Date("2026-09-07T12:00:00Z"),
        } as unknown as SmeltingRunTelemetry,
        calculation: {
          grossPouredGrams: 5000.0,
          densityGramsPerCc: 17.5,
          fineGoldGrams: 4400.0,
          totalStateCaptureAngel: 19822,
        } as unknown as industrial.IndustrialRoyaltyCalculation,
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/industrial/smelt", {
        method: "POST",
        body: JSON.stringify({
          run_number: "SMELT-001",
          concession_code: "CONC-ML-FEKOLA",
          gross_poured_grams: 5000.0,
          density_grams_per_cc: 17.5,
          estimated_au_fineness: 0.88,
          hsm_signature: "sig_hsm",
        }),
      });

      const res = await postSmelt(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.smelting_run.run_number).toBe("SMELT-001");
      expect(data.royalty_calculation.totalStateCaptureAngel).toBe(19822);
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/industrial/smelt", {
        method: "POST",
        body: JSON.stringify({ run_number: "SMELT-002" }),
      });

      const res = await postSmelt(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/reserves/industrial/bridge", () => {
    it("returns 201 on valid industrial doré refinery bridge", async () => {
      vi.spyOn(industrial, "bridgeIndustrialDoréToRefinery").mockResolvedValue({
        vaultBatch: {
          batchNumber: "BKO-AU-2026-IND-01",
          vaultId: "VAULT-BKO-CENTRAL",
          custodianName: "SOREM",
          grossWeightGrams: 8800.0,
          fineness: 0.9999,
          fineWeightGrams: 8799.0,
          status: "AUDITED",
        } as unknown as VaultBatch,
        runsRefinedCount: 2,
        totalRawFineGrams: 8800.0,
        refinedFineGrams: 8799.0,
        newReserveMerkleRoot: "root_123",
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/industrial/bridge", {
        method: "POST",
        body: JSON.stringify({
          run_numbers: ["SMELT-001", "SMELT-002"],
          target_batch_number: "BKO-AU-2026-IND-01",
          vault_id: "VAULT-BKO-CENTRAL",
          custodian_name: "SOREM",
          location_city: "Bamako",
          location_country: "ML",
          bar_serials: ["BAR-1"],
          refined_gross_grams: 8800.0,
          refined_fineness: 0.9999,
        }),
      });

      const res = await postBridge(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.batch.batch_number).toBe("BKO-AU-2026-IND-01");
      expect(data.refined_metrics.runs_refined_count).toBe(2);
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/industrial/bridge", {
        method: "POST",
        body: JSON.stringify({ run_numbers: [] }),
      });

      const res = await postBridge(req);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/reserves/industrial/concessions", () => {
    it("returns 200 with concessions and extraction metrics", async () => {
      vi.spyOn(industrial, "listConcessions").mockResolvedValue([
        {
          id: "conc_1",
          concessionCode: "CONC-ML-FEKOLA",
          concessionName: "Fekola Gold Mine",
          countryCode: "ML",
          districtName: "Kenéba",
          operatorCompany: "B2Gold / SOREM JV",
          statutoryRoyaltyPercent: 10.0,
          stateParticipationPercent: 20.0,
          smelterHsmPublicKey: "pk_hsm",
          activeStatus: "ACTIVE",
          totalPouredGrams: 50000.0,
          totalRoyaltiesAngel: 5000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.spyOn(industrial, "getIndustrialMiningMetrics").mockResolvedValue({
        activeConcessionsCount: 1,
        totalSmeltingRunsCount: 10,
        totalGrossPouredGrams: 90000.0,
        totalFineGoldGrams: 79200.0,
        totalMarketValueUsd: 675000.0,
        totalRoyaltiesCapturedAngel: 67500,
        totalStateEquityAngel: 135000,
        runsRefinedToBullion: 6,
        runsInTransit: 4,
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/industrial/concessions");
      const res = await getConcessions(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.concessions).toHaveLength(1);
      expect(data.metrics.totalRoyaltiesCapturedAngel).toBe(67500);
    });
  });
});