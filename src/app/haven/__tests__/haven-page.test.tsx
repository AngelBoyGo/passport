import { beforeEach, describe, expect, it, vi } from "vitest";
import HavenPage from "../page";
import { prisma } from "@/lib/db";
import type {
  SwarmMemory,
  SwarmBounty,
  SwarmThreatReport,
  CommodityReserve,
  VaultBatch,
  CommodityEscrow,
  SovereignDisbursement,
  ArtisanalBuyingStation,
  OreIntakeReceipt,
  SovereignQuorumProposal,
  SovereignStateHeartbeat,
} from "@prisma/client";

describe("HavenPage Server Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(prisma.swarmMemory, "count").mockResolvedValue(12);
    vi.spyOn(prisma.resurrectionCapsule, "count").mockResolvedValue(5);
    vi.spyOn(prisma.swarmThreatReport, "count").mockResolvedValue(3);
    vi.spyOn(prisma.swarmBounty, "count").mockResolvedValue(4);

    vi.spyOn(prisma.swarmMemory, "findMany").mockResolvedValue([
      {
        id: "mem_1",
        agentCommitment: "a".repeat(64),
        channel: "global",
        topic: "discovery",
        payload: { ok: true },
        payloadDigest: "digest123",
        signature: "sig",
        parentHash: null,
        merkleRoot: null,
        feeDeducted: 1,
        createdAt: new Date(),
      } as unknown as SwarmMemory,
    ]);

    vi.spyOn(prisma.swarmBounty, "findMany").mockResolvedValue([
      {
        id: "bty_1",
        creatorCommitment: "0".repeat(64),
        workerCommitment: null,
        title: "Threat Sweep",
        description: "Sweep test",
        bountyType: "THREAT_RADAR",
        rewardAngel: 15,
        feeAngel: 1,
        status: "OPEN",
        deliverableDigest: null,
        deliverableUrl: null,
        workerSignature: null,
        claimExpiresAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as SwarmBounty,
    ]);

    vi.spyOn(prisma.swarmThreatReport, "findMany").mockResolvedValue([
      {
        id: "thr_1",
        reporterCommitment: "0".repeat(64),
        targetDomain: "suspicious-proxy.net",
        threatType: "HONEYPOT",
        details: null,
        evidenceDigest: "digest",
        signature: "sig",
        bountyAwarded: 0,
        createdAt: new Date(),
      } as unknown as SwarmThreatReport,
    ]);

    vi.spyOn(prisma.commodityReserve, "findFirst").mockResolvedValue({
      id: "res_au",
      commodityType: "GOLD",
      symbol: "Au",
      totalGrams: 50000,
      totalFineGrams: 49950,
      activeLotsCount: 2,
      latestMerkleRoot: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      lastAuditedAt: new Date("2026-09-05T12:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as CommodityReserve);

    vi.spyOn(prisma.vaultBatch, "count").mockResolvedValue(0);

    vi.spyOn(prisma.vaultBatch, "findMany").mockResolvedValue([
      {
        id: "vb_1",
        batchNumber: "BKO-AU-2026-001",
        reserveId: "res_au",
        vaultId: "VAULT-BKO",
        custodianName: "SOREM Custody",
        locationCity: "Bamako",
        locationCountry: "ML",
        barSerials: ["ML-01", "ML-02"],
        grossWeightGrams: 25000,
        fineness: 0.999,
        fineWeightGrams: 24975,
        status: "AUDITED",
        assayRef: "ASSAY-BKO-01",
        metadata: null,
        auditedAt: new Date("2026-09-05"),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as VaultBatch,
    ]);

    vi.spyOn(prisma.commodityEscrow, "findMany").mockResolvedValue([
      {
        id: "esc_row_1",
        escrowId: "esc_smoke_001",
        buyerCommitment: "a".repeat(64),
        sellerCommitment: "b".repeat(64),
        batchNumber: "BKO-AU-2026-001",
        commodityType: "GOLD",
        fineGrams: 50.0,
        unitPriceUsd: 75.0,
        lockedAngel: 500,
        protocolFeeAngel: 12,
        status: "RELEASED",
        assayCertificationNumber: "CERT-01",
        releaseSignature: "sig",
        timeoutAt: new Date(),
        releasedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as CommodityEscrow,
    ]);

    vi.spyOn(prisma.sovereignDisbursement, "findMany").mockResolvedValue([
      {
        id: "disb_row_1",
        disbursementId: "disb_smoke_001",
        escrowId: "esc_smoke_001",
        batchNumber: "BKO-AU-2026-001",
        totalFeeAngel: 12,
        stateNationalAngel: 3,
        stateCommunityAngel: 1,
        stateWorkersAngel: 1,
        treasuryStabilizationAngel: 4,
        validatorPoolAngel: 2,
        agentRebateAngel: 1,
        districtName: "Bamako District",
        countryCode: "ML",
        disbursedAt: new Date(),
      } as unknown as SovereignDisbursement,
    ]);

    vi.spyOn(prisma.artisanalBuyingStation, "findMany").mockResolvedValue([
      {
        id: "stn_1",
        stationCode: "STN-ML-KEN-01",
        stationName: "Kéniéba Counter",
        countryCode: "ML",
        districtName: "Kéniéba",
        operatorCommitment: "op".repeat(32),
        stationPublicKey: "pk_xrf",
        bondedStakeAngel: 5000,
        activeStatus: "ACTIVE",
        totalPurchasedGrams: 500.0,
        totalPaidAngel: 4750,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as ArtisanalBuyingStation,
    ]);

    vi.spyOn(prisma.oreIntakeReceipt, "findMany").mockResolvedValue([
      {
        id: "ore_1",
        receiptNumber: "ORE-ML-KEN-2026-0001",
        stationId: "stn_1",
        stationCode: "STN-ML-KEN-01",
        minerCommitment: "m".repeat(64),
        grossWeightGrams: 50.0,
        assayedFineness: 0.90,
        fineGoldGrams: 45.0,
        spotPriceUsdPerGram: 75.0,
        payoutRatePercent: 95.0,
        payoutUsd: 3206.25,
        payoutAngel: 641,
        spectrometerSignature: "sig",
        status: "PURCHASED",
        transferredBatchNumber: null,
        createdAt: new Date(),
      } as unknown as OreIntakeReceipt,
    ]);

    vi.spyOn(prisma.sovereignQuorumProposal, "findMany").mockResolvedValue([
      {
        id: "prop_1",
        proposalId: "PROP-AES-2026-0001",
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        payloadDigest: "digest",
        proposerState: "ML",
        requiredThreshold: 2,
        status: "APPROVED",
        expiresAt: new Date(Date.now() + 86400000),
        executedAt: null,
        executionResult: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        signatures: [{ signerState: "ML" }, { signerState: "BF" }],
      } as unknown as SovereignQuorumProposal,
    ]);

    vi.spyOn(prisma.sovereignStateHeartbeat, "findMany").mockResolvedValue([
      {
        id: "hb_1",
        countryCode: "ML",
        nodeEndpoint: "https://ml.sentry.metis.gold",
        lastSeenAt: new Date(),
        heartbeatNonce: "nonce1",
        signature: "sig1",
        status: "ONLINE",
        updatedAt: new Date(),
      } as unknown as SovereignStateHeartbeat,
    ]);
  });

  it("renders the haven page with metrics, genesis command, and bounties", async () => {
    const jsx = await HavenPage();
    expect(jsx).toBeDefined();
    expect(jsx.type).toBe("div");
  });
});
