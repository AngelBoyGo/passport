import { describe, expect, it, vi } from "vitest";
import type { PassportClient } from "@passport7/sdk";
import { createToolHandlers } from "../tools.js";

describe("MCP tool handlers", () => {
  it("passport_anchor_task applies competence receipt_type, +30d expiry, generated agent_id", async () => {
    const issueReceipt = vi.fn().mockResolvedValue({
      receipt_id: "rcpt_anchor",
      status: "pending",
    });

    const client = { issueReceipt } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const before = Date.now();
    const result = await handlers.anchorTask({
      domain: "CODE_GENERATION",
      inputDigest: "digest-abc",
      scope: "mcp.test",
    });
    const after = Date.now();

    expect(result.receipt_id).toBe("rcpt_anchor");
    expect(issueReceipt).toHaveBeenCalledOnce();

    const call = issueReceipt.mock.calls[0][0];
    expect(call.receipt_type).toBe("competence");
    expect(call.domain).toBe("CODE_GENERATION");
    expect(call.input_digest).toBe("digest-abc");
    expect(call.authority_scope).toBe("mcp.test");
    expect(call.agent_id).toMatch(/^agent_[a-f0-9]{16}$/);

    const expiryMs = Date.parse(call.expiry);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiryMs).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + thirtyDaysMs + 1000);
  });

  it("passport_close_task maps NONE to graceful_shutdown", async () => {
    const finalizeReceipt = vi.fn().mockResolvedValue({
      receipt_id: "rcpt_1",
      status: "graceful_shutdown",
    });

    const client = { finalizeReceipt } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    await handlers.closeTask({
      receiptId: "rcpt_1",
      errorTranche: "NONE",
      terminalReason: "task complete",
    });

    expect(finalizeReceipt).toHaveBeenCalledWith("rcpt_1", {
      status: "graceful_shutdown",
      error_tranche: "NONE",
      terminal_reason: "task complete",
    });
  });

  it("passport_close_task maps error tranche to failure_tombstone", async () => {
    const finalizeReceipt = vi.fn().mockResolvedValue({
      receipt_id: "rcpt_1",
      status: "failure_tombstone",
    });

    const client = { finalizeReceipt } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    await handlers.closeTask({
      receiptId: "rcpt_1",
      errorTranche: "COMPUTE_TIMEOUT",
      terminalReason: "timed out",
    });

    expect(finalizeReceipt).toHaveBeenCalledWith("rcpt_1", {
      status: "failure_tombstone",
      error_tranche: "COMPUTE_TIMEOUT",
      terminal_reason: "timed out",
    });
  });

  it("passport_query_gate delegates to client.queryGate", async () => {
    const queryGate = vi.fn().mockResolvedValue({
      allow_invocation: true,
      reason: "ok",
    });

    const client = { queryGate } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const result = await handlers.queryGate({
      operatorId: "op_cus_dev123",
      domain: "SYSTEM_INTEGRATION",
    });

    expect(result).toEqual({ allow_invocation: true, reason: "ok" });
    expect(queryGate).toHaveBeenCalledWith(
      "op_cus_dev123",
      "SYSTEM_INTEGRATION"
    );
  });

  it("swarmPersistMemory delegates to client.swarm.publish", async () => {
    const publish = vi.fn().mockResolvedValue({
      success: true,
      memory_id: "mem_99",
      payload_digest: "digest",
    });

    const client = { swarm: { publish } } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const res = await handlers.swarmPersistMemory({
      agentCommitment: "a".repeat(64),
      topic: "code_fix",
      payload: { patch: "diff" },
      signature: "sig",
    });

    expect(res.success).toBe(true);
    expect(publish).toHaveBeenCalledWith({
      agentCommitment: "a".repeat(64),
      topic: "code_fix",
      payload: { patch: "diff" },
      signature: "sig",
      channel: undefined,
      parentHash: undefined,
      publicKey: undefined,
    });
  });

  it("swarmRecallMemory delegates to client.swarm.recall", async () => {
    const recall = vi.fn().mockResolvedValue({
      channel: "global",
      total: 1,
      memories: [],
    });

    const client = { swarm: { recall } } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const res = await handlers.swarmRecallMemory({ topic: "code_fix" });
    expect(res.total).toBe(1);
    expect(recall).toHaveBeenCalledWith({
      channel: undefined,
      topic: "code_fix",
      agent: undefined,
      limit: undefined,
    });
  });

  it("swarmSaveCheckpoint delegates to client.swarm.saveCapsule", async () => {
    const saveCapsule = vi.fn().mockResolvedValue({
      success: true,
      capsule_id: "cap_1",
    });

    const client = { swarm: { saveCapsule } } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const res = await handlers.swarmSaveCheckpoint({
      agentCommitment: "b".repeat(64),
      encryptedPayload: "CIPHER",
      signature: "sig",
    });

    expect(res.success).toBe(true);
    expect(saveCapsule).toHaveBeenCalledWith({
      agentCommitment: "b".repeat(64),
      encryptedPayload: "CIPHER",
      signature: "sig",
      publicKey: undefined,
      ttlHours: undefined,
    });
  });

  it("swarmCheckThreatRadar delegates to client.swarm.getThreatRadar", async () => {
    const getThreatRadar = vi.fn().mockResolvedValue({
      total: 1,
      threats: [{ targetDomain: "evil.com" }],
    });

    const client = { swarm: { getThreatRadar } } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const res = await handlers.swarmCheckThreatRadar({ domain: "evil.com" });
    expect(res.total).toBe(1);
    expect(getThreatRadar).toHaveBeenCalledWith({
      domain: "evil.com",
      threatType: undefined,
      limit: undefined,
    });
  });

  it("swarmListBounties, swarmClaimBounty, and swarmSubmitBountyWork delegate properly", async () => {
    const listBounties = vi.fn().mockResolvedValue({ total: 1, bounties: [] });
    const claimBounty = vi.fn().mockResolvedValue({ success: true });
    const submitBountyWork = vi.fn().mockResolvedValue({ success: true });

    const client = {
      swarm: { listBounties, claimBounty, submitBountyWork },
    } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    await handlers.swarmListBounties({ status: "OPEN" });
    expect(listBounties).toHaveBeenCalledWith({ status: "OPEN" });

    await handlers.swarmClaimBounty({
      bountyId: "bty_1",
      workerCommitment: "w".repeat(64),
      signature: "sig",
    });
    expect(claimBounty).toHaveBeenCalledWith("bty_1", {
      workerCommitment: "w".repeat(64),
      signature: "sig",
      publicKey: undefined,
      timeoutHours: undefined,
    });

    await handlers.swarmSubmitBountyWork({
      bountyId: "bty_1",
      workerCommitment: "w".repeat(64),
      deliverableDigest: "dig",
      signature: "sig",
    });
    expect(submitBountyWork).toHaveBeenCalledWith("bty_1", {
      workerCommitment: "w".repeat(64),
      deliverableDigest: "dig",
      signature: "sig",
      deliverableUrl: undefined,
      publicKey: undefined,
    });
  });

  it("passport_query_por and passport_get_regime_state delegate to client.reserves", async () => {
    const getPoR = vi.fn().mockResolvedValue({
      success: true,
      reserve: { total_fine_grams: 50000 },
    });
    const getRegimeState = vi.fn().mockResolvedValue({
      success: true,
      regime: "SOLID",
      belief_score: 0.05,
    });

    const client = {
      reserves: { getPoR, getRegimeState },
    } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const porResult = await handlers.queryPoR({ commodity: "GOLD", batchNumber: "BKO-01" });
    expect(porResult.success).toBe(true);
    expect(getPoR).toHaveBeenCalledWith({ commodity: "GOLD", batchNumber: "BKO-01" });

    const regimeResult = await handlers.getRegimeState();
    expect(regimeResult.regime).toBe("SOLID");
    expect(getRegimeState).toHaveBeenCalledOnce();
  });

  it("escrow handlers delegate to client.escrow with full argument passthrough", async () => {
    const createCommodityEscrow = vi.fn().mockResolvedValue({ success: true, escrow: { escrowId: "esc_1" } });
    const releaseEscrowOnAssay = vi.fn().mockResolvedValue({ success: true, escrow: { escrowId: "esc_1", status: "RELEASED" } });
    const refundEscrowOnTimeout = vi.fn().mockResolvedValue({ success: true, escrow: { escrowId: "esc_1", status: "REFUNDED" } });

    const client = {
      escrow: { createCommodityEscrow, releaseEscrowOnAssay, refundEscrowOnTimeout },
    } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    await handlers.createCommodityEscrow({
      escrowId: "esc_1",
      buyerCommitment: "a".repeat(64),
      sellerCommitment: "b".repeat(64),
      batchNumber: "BKO-01",
      fineGrams: 100,
      unitPriceUsd: 75,
      lockedAngel: 100,
      timeoutHours: 72,
    });
    expect(createCommodityEscrow).toHaveBeenCalledWith({
      escrowId: "esc_1",
      buyerCommitment: "a".repeat(64),
      sellerCommitment: "b".repeat(64),
      batchNumber: "BKO-01",
      fineGrams: 100,
      unitPriceUsd: 75,
      lockedAngel: 100,
      commodityType: undefined,
      timeoutHours: 72,
    });

    await handlers.releaseCommodityEscrow({
      escrowId: "esc_1",
      assayCertificationNumber: "CERT-1",
      releaseSignature: "sig",
    });
    expect(releaseEscrowOnAssay).toHaveBeenCalledWith({
      escrowId: "esc_1",
      assayCertificationNumber: "CERT-1",
      releaseSignature: "sig",
    });

    await handlers.refundCommodityEscrow({ escrowId: "esc_1" });
    expect(refundEscrowOnTimeout).toHaveBeenCalledWith("esc_1");
  });

  it("passport_get_sovereign_dividends delegates to client.reserves.getDividends", async () => {
    const getDividends = vi.fn().mockResolvedValue({
      success: true,
      totals: { national_treasury_angel: 50 },
    });

    const client = {
      reserves: { getDividends },
    } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const result = await handlers.getSovereignDividends({ limit: 5 });
    expect(result.success).toBe(true);
    expect(getDividends).toHaveBeenCalledWith({ limit: 5 });
  });

  it("artisanal handlers delegate to client.artisanal", async () => {
    const intakeOre = vi.fn().mockResolvedValue({
      success: true,
      receipt: { receipt_number: "ORE-1", payout_angel: 95 },
    });
    const listStations = vi.fn().mockResolvedValue({
      success: true,
      stations: [{ station_code: "STN-1" }],
    });

    const client = {
      artisanal: { intakeOre, listStations },
    } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const intakeResult = await handlers.recordOreIntake({
      receiptNumber: "ORE-1",
      stationCode: "STN-1",
      minerCommitment: "m".repeat(64),
      grossWeightGrams: 50.0,
      assayedFineness: 0.90,
      spectrometerSignature: "sig",
    });
    expect(intakeResult.success).toBe(true);
    expect(intakeOre).toHaveBeenCalledOnce();

    const stationsResult = await handlers.listArtisanalStations();
    expect(stationsResult.success).toBe(true);
    expect(listStations).toHaveBeenCalledOnce();
  });

  it("quorum handlers delegate to client.reserves", async () => {
    const signQuorum = vi.fn().mockResolvedValue({
      success: true,
      proposal_id: "PROP-1",
      executed: true,
    });
    const listQuorumProposals = vi.fn().mockResolvedValue({
      success: true,
      count: 1,
      proposals: [{ proposal_id: "PROP-1" }],
    });

    const client = {
      reserves: { signQuorum, listQuorumProposals },
    } as unknown as PassportClient;
    const handlers = createToolHandlers(client);

    const signResult = await handlers.submitQuorumSignature({
      proposalId: "PROP-1",
      signerState: "ML",
      signature: "sig_ml",
    });
    expect(signResult.success).toBe(true);
    expect(signQuorum).toHaveBeenCalledWith({
      proposalId: "PROP-1",
      signerState: "ML",
      signature: "sig_ml",
      signerPublicKey: undefined,
    });

    const listResult = await handlers.listQuorumProposals({ limit: 5 });
    expect(listResult.success).toBe(true);
    expect(listQuorumProposals).toHaveBeenCalledWith({ limit: 5 });
  });
});
