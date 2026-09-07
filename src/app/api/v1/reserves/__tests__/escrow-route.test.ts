import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { POST as postEscrow, GET as getEscrow } from "../escrow/route";
import * as rwaEscrow from "@/lib/reserves/rwa-escrow";

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: vi.fn(),
}));

type EscrowRecord = Awaited<ReturnType<typeof rwaEscrow.createCommodityEscrow>>;

function escrowRecord(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: "cuid_1",
    escrowId: "esc_1",
    buyerCommitment: "a".repeat(64),
    sellerCommitment: "b".repeat(64),
    batchNumber: "BKO-01",
    commodityType: "GOLD",
    fineGrams: 100,
    unitPriceUsd: 75,
    lockedAngel: 100,
    protocolFeeAngel: 3,
    status: "HELD",
    assayCertificationNumber: null,
    releaseSignature: null,
    timeoutAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    releasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as EscrowRecord;
}

describe("RWA Escrow API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(authenticateApiKey).mockResolvedValue({ id: "op_1" } as never);
  });

  describe("POST /api/v1/reserves/escrow", () => {
    it("create action returns 201 and delegates to the service", async () => {
      vi.spyOn(rwaEscrow, "createCommodityEscrow").mockResolvedValue(escrowRecord());

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/escrow", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          escrow_id: "esc_1",
          buyer_commitment: "a".repeat(64),
          seller_commitment: "b".repeat(64),
          batch_number: "BKO-01",
          fine_grams: 100,
          unit_price_usd: 75,
          locked_angel: 100,
        }),
      });

      const res = await postEscrow(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(rwaEscrow.createCommodityEscrow).toHaveBeenCalledOnce();
    });

    it("release action returns 200", async () => {
      vi.spyOn(rwaEscrow, "releaseEscrowOnAssay").mockResolvedValue(
        escrowRecord({ status: "RELEASED" })
      );

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/escrow", {
        method: "POST",
        body: JSON.stringify({
          action: "release",
          escrow_id: "esc_1",
          assay_certification_number: "CERT-1",
          release_signature: "sig",
        }),
      });

      const res = await postEscrow(req);
      expect(res.status).toBe(200);
    });

    it("refund action returns 200", async () => {
      vi.spyOn(rwaEscrow, "refundEscrowOnTimeout").mockResolvedValue(
        escrowRecord({ status: "REFUNDED" })
      );

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/escrow", {
        method: "POST",
        body: JSON.stringify({ action: "refund", escrow_id: "esc_1" }),
      });

      const res = await postEscrow(req);
      expect(res.status).toBe(200);
    });

    it("unknown action returns 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/escrow", {
        method: "POST",
        body: JSON.stringify({ action: "bogus", escrow_id: "esc_1" }),
      });

      const res = await postEscrow(req);
      expect(res.status).toBe(400);
    });

    it("maps not-found errors to 404", async () => {
      vi.spyOn(rwaEscrow, "createCommodityEscrow").mockRejectedValue(
        new Error("Vault batch 'BKO-01' not found")
      );

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/escrow", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          escrow_id: "esc_1",
          buyer_commitment: "a".repeat(64),
          seller_commitment: "b".repeat(64),
          batch_number: "BKO-01",
          fine_grams: 100,
          unit_price_usd: 75,
          locked_angel: 100,
        }),
      });

      const res = await postEscrow(req);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/reserves/escrow", () => {
    it("returns 404 for a missing escrow", async () => {
      vi.spyOn(rwaEscrow, "getEscrow").mockResolvedValue(null);

      const req = new NextRequest(
        "https://passport.metis.gold/api/v1/reserves/escrow?escrow_id=missing"
      );
      const res = await getEscrow(req);
      expect(res.status).toBe(404);
    });

    it("returns the escrow when found", async () => {
      vi.spyOn(rwaEscrow, "getEscrow").mockResolvedValue(escrowRecord());

      const req = new NextRequest(
        "https://passport.metis.gold/api/v1/reserves/escrow?escrow_id=esc_1"
      );
      const res = await getEscrow(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.escrow.escrowId).toBe("esc_1");
    });
  });
});
