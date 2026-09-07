import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as postDispatch } from "../transit/dispatch/route";
import { POST as postCheckpoint } from "../transit/checkpoint/route";
import { POST as postArrive } from "../transit/arrive/route";
import { GET as getCorridors } from "../transit/corridors/route";
import * as transit from "@/lib/reserves/bonded-transit";

describe("Bonded Transit & Coastal Corridors API Endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/reserves/transit/dispatch", () => {
    it("returns 201 with waybill on valid dispatch", async () => {
      vi.spyOn(transit, "dispatchDiplomaticTransit").mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        batchNumber: "BKO-01",
        destinationPortCode: "PORT-LOME-TG",
        carrierCommitment: "c".repeat(64),
        carrierBondAngel: 5000,
        fineGoldGrams: 500.0,
        status: "DISPATCHED",
        dispatchedAt: new Date("2026-09-07T12:00:00Z"),
      } as unknown as Awaited<ReturnType<typeof transit.dispatchDiplomaticTransit>>);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/transit/dispatch", {
        method: "POST",
        body: JSON.stringify({
          waybill_number: "WAYBILL-001",
          batch_number: "BKO-01",
          destination_port_code: "PORT-LOME-TG",
          origin_vault_id: "VAULT-BKO",
          carrier_commitment: "c".repeat(64),
          diplomatic_seal_digest: "d".repeat(64),
        }),
      });

      const res = await postDispatch(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.waybill.waybill_number).toBe("WAYBILL-001");
      expect(data.waybill.status).toBe("DISPATCHED");
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/transit/dispatch", {
        method: "POST",
        body: JSON.stringify({
          waybill_number: "WAYBILL-002",
        }),
      });

      const res = await postDispatch(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/reserves/transit/checkpoint", () => {
    it("returns 200 with updated checkpoints", async () => {
      vi.spyOn(transit, "recordIntermediateCheckpoint").mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        status: "IN_TRANSIT",
        checkpointsVisited: ["SIKASSO", "OUAGA"],
      } as unknown as Awaited<ReturnType<typeof transit.recordIntermediateCheckpoint>>);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/transit/checkpoint", {
        method: "POST",
        body: JSON.stringify({
          waybill_number: "WAYBILL-001",
          checkpoint_name: "OUAGA",
          inspector_signature: "sig",
          inspector_public_key: "pk",
        }),
      });

      const res = await postCheckpoint(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.waybill.status).toBe("IN_TRANSIT");
      expect(data.waybill.checkpoints_visited).toContain("OUAGA");
    });
  });

  describe("POST /api/v1/reserves/transit/arrive", () => {
    it("returns 200 with port arrival notarization", async () => {
      vi.spyOn(transit, "recordPortArrival").mockResolvedValue({
        waybillNumber: "WAYBILL-001",
        status: "PORT_ARRIVED",
        arrivedAt: new Date("2026-09-08T12:00:00Z"),
      } as unknown as Awaited<ReturnType<typeof transit.recordPortArrival>>);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/transit/arrive", {
        method: "POST",
        body: JSON.stringify({
          waybill_number: "WAYBILL-001",
          port_code: "PORT-LOME-TG",
          enclave_signature: "sig_enclave",
        }),
      });

      const res = await postArrive(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.waybill.status).toBe("PORT_ARRIVED");
    });
  });

  describe("GET /api/v1/reserves/transit/corridors", () => {
    it("returns 200 with corridors, waybills, and metrics", async () => {
      vi.spyOn(transit, "listTransitCorridors").mockResolvedValue({
        enclaves: [
          {
            id: "enc_1",
            portCode: "PORT-LOME-TG",
            portName: "Port of Lomé",
            countryCode: "TG",
            customsAuthorityName: "OTR",
            enclavePublicKey: "pk",
            clearingFeeShareBps: 50,
            totalTransitGrams: 5000,
            totalFeesEarnedAngel: 50,
            activeStatus: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        recentWaybills: [
          {
            id: "wb_1",
            waybillNumber: "WAYBILL-001",
            batchNumber: "BKO-01",
            enclaveId: "enc_1",
            destinationPortCode: "PORT-LOME-TG",
            originVaultId: "VAULT-BKO",
            carrierCommitment: "c".repeat(64),
            carrierBondAngel: 5000,
            grossWeightGrams: 500,
            fineGoldGrams: 499.5,
            diplomaticSealDigest: "d".repeat(64),
            status: "IN_TRANSIT",
            checkpointsVisited: ["SIKASSO"],
            dispatchedAt: new Date("2026-09-07T12:00:00Z"),
            arrivedAt: null,
            clearedAt: null,
            slashedAt: null,
          },
        ],
      });

      vi.spyOn(transit, "getTransitMetrics").mockResolvedValue({
        activeEnclavesCount: 1,
        activeWaybillsCount: 1,
        transitFineGoldGrams: 499.5,
        totalCarrierBondsLockedAngel: 5000,
        totalConvoysArrived: 0,
        totalBreachesDetected: 0,
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/transit/corridors");
      const res = await getCorridors(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.enclaves).toHaveLength(1);
      expect(data.recent_waybills).toHaveLength(1);
    });
  });
});
