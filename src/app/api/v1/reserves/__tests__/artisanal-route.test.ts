import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as postIntake } from "../artisanal/intake/route";
import { GET as getStations } from "../artisanal/stations/route";
import { POST as postBridge } from "../artisanal/bridge/route";
import * as artisanalSourcing from "@/lib/reserves/artisanal-sourcing";

describe("Artisanal Sourcing API Endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/reserves/artisanal/intake", () => {
    it("returns 201 with receipt details on valid intake", async () => {
      vi.spyOn(artisanalSourcing, "processOreIntake").mockResolvedValue({
        receipt: {
          receiptNumber: "ORE-001",
          stationCode: "STN-KEN-01",
          minerCommitment: "m".repeat(64),
          grossWeightGrams: 50.0,
          assayedFineness: 0.90,
          fineGoldGrams: 45.0,
          payoutUsd: 3206.25,
          payoutAngel: 641,
          status: "PURCHASED",
          createdAt: new Date("2026-09-07T12:00:00Z"),
        } as unknown as Awaited<ReturnType<typeof artisanalSourcing.processOreIntake>>["receipt"],
        payout: {
          grossGrams: 50.0,
          fineness: 0.90,
          fineGrams: 45.0,
          spotPriceUsd: 75.0,
          payoutRatePercent: 95.0,
          payoutUsd: 3206.25,
          payoutAngel: 641,
        },
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/artisanal/intake", {
        method: "POST",
        body: JSON.stringify({
          receipt_number: "ORE-001",
          station_code: "STN-KEN-01",
          miner_commitment: "m".repeat(64),
          gross_weight_grams: 50.0,
          assayed_fineness: 0.90,
          spectrometer_signature: "sig_xrf",
        }),
      });

      const res = await postIntake(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.receipt.receipt_number).toBe("ORE-001");
      expect(data.payout_details.payout_angel).toBe(641);
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/artisanal/intake", {
        method: "POST",
        body: JSON.stringify({
          receipt_number: "ORE-002",
        }),
      });

      const res = await postIntake(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing required fields");
    });
  });

  describe("GET /api/v1/reserves/artisanal/stations", () => {
    it("returns active stations and formalization metrics", async () => {
      vi.spyOn(artisanalSourcing, "listBuyingStations").mockResolvedValue([
        {
          id: "stn_1",
          stationCode: "STN-KEN-01",
          stationName: "Kéniéba Counter",
          countryCode: "ML",
          districtName: "Kéniéba",
          operatorCommitment: "op".repeat(32),
          stationPublicKey: "pk_xrf",
          bondedStakeAngel: 5000,
          activeStatus: "ACTIVE",
          totalPurchasedGrams: 1000.0,
          totalPaidAngel: 9500,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.spyOn(artisanalSourcing, "getArtisanalMetrics").mockResolvedValue({
        totalBuyingStations: 1,
        activeStations: 1,
        totalIntakeReceipts: 5,
        totalGrossGramsFormalized: 1000.0,
        totalFineGramsFormalized: 900.0,
        totalAngelPaidToMiners: 9500,
        receiptsRefinedToBullion: 2,
        receiptsInTransit: 3,
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/artisanal/stations");
      const res = await getStations(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.stations).toHaveLength(1);
      expect(data.metrics.totalGrossGramsFormalized).toBe(1000.0);
    });
  });

  describe("POST /api/v1/reserves/artisanal/bridge", () => {
    it("returns 201 on valid doré refinery bridge", async () => {
      vi.spyOn(artisanalSourcing, "bridgeDoréToRefinedVault").mockResolvedValue({
        vaultBatch: {
          batchNumber: "BKO-AU-2026-REFINED-01",
          vaultId: "VAULT-BKO-CENTRAL",
          custodianName: "SOREM",
          grossWeightGrams: 100.0,
          fineness: 0.9999,
          fineWeightGrams: 99.99,
          status: "AUDITED",
        } as unknown as Awaited<ReturnType<typeof artisanalSourcing.bridgeDoréToRefinedVault>>["vaultBatch"],
        receiptsRefinedCount: 2,
        totalRawFineGrams: 100.0,
        refinedFineGrams: 99.99,
        newReserveMerkleRoot: "root_123",
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/artisanal/bridge", {
        method: "POST",
        body: JSON.stringify({
          receipt_numbers: ["ORE-1", "ORE-2"],
          target_batch_number: "BKO-AU-2026-REFINED-01",
          vault_id: "VAULT-BKO-CENTRAL",
          custodian_name: "SOREM",
          location_city: "Bamako",
          location_country: "ML",
          bar_serials: ["BAR-1"],
          refined_gross_grams: 100.0,
          refined_fineness: 0.9999,
        }),
      });

      const res = await postBridge(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.batch.batch_number).toBe("BKO-AU-2026-REFINED-01");
      expect(data.refined_metrics.receipts_refined_count).toBe(2);
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/artisanal/bridge", {
        method: "POST",
        body: JSON.stringify({
          receipt_numbers: [],
        }),
      });

      const res = await postBridge(req);
      expect(res.status).toBe(400);
    });
  });
});
