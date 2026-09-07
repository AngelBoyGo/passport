import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassportClient } from "../client.js";

describe("PassportClient", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ receipt_id: "rcpt_1", status: "pending" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const client = new PassportClient({
    apiKey: "pk_test_secret",
    baseUrl: "https://passport.example.com",
  });

  it("issueReceipt POSTs to /api/v1/receipts with Bearer auth", async () => {
    await client.issueReceipt({
      agent_id: "agent-1",
      receipt_type: "competence",
      input_digest: "abc123",
      authority_scope: "test.scope",
      expiry: "2026-07-14T00:00:00.000Z",
      domain: "CODE_GENERATION",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://passport.example.com/api/v1/receipts");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer pk_test_secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      agent_id: "agent-1",
      receipt_type: "competence",
      input_digest: "abc123",
      authority_scope: "test.scope",
      expiry: "2026-07-14T00:00:00.000Z",
      domain: "CODE_GENERATION",
    });
  });

  it("finalizeReceipt POSTs to /api/v1/receipts/:id/finalize with Bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ receipt_id: "rcpt_1", status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await client.finalizeReceipt("rcpt_1", {
      status: "graceful_shutdown",
      error_tranche: "NONE",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://passport.example.com/api/v1/receipts/rcpt_1/finalize"
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer pk_test_secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      status: "graceful_shutdown",
      error_tranche: "NONE",
    });
  });

  it("queryGate POSTs to /api/v1/gate/verify without Bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ allow_invocation: true, reason: "ok" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    await client.queryGate("op_cus_dev123", "SYSTEM_INTEGRATION");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://passport.example.com/api/v1/gate/verify");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      operator_id: "op_cus_dev123",
      domain: "SYSTEM_INTEGRATION",
    });
  });

  it("swarm.publish POSTs to /api/v1/swarm/memory with auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          memory_id: "mem_1",
          payload_digest: "digest_1",
          verified: true,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await client.swarm.publish({
      agentCommitment: "a".repeat(64),
      channel: "research",
      topic: "autonomous_discovery",
      payload: { finding: "found_path" },
      signature: "sig_hex",
    });

    expect(res.success).toBe(true);
    expect(res.memory_id).toBe("mem_1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://passport.example.com/api/v1/swarm/memory");
    expect(init.method).toBe("POST");
  });

  it("swarm.recall GETs from /api/v1/swarm/memory with query params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ channel: "research", total: 1, memories: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await client.swarm.recall({
      channel: "research",
      topic: "autonomous_discovery",
      limit: 10,
    });

    expect(res.total).toBe(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("channel=research");
    expect(url).toContain("topic=autonomous_discovery");
    expect(url).toContain("limit=10");
  });

  it("swarm.saveCapsule and restoreCapsule work via HTTP", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, capsule_id: "cap_1", version: 1 }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const saved = await client.swarm.saveCapsule({
      agentCommitment: "b".repeat(64),
      encryptedPayload: "CIPHERTEXT",
      signature: "sig",
    });
    expect(saved.capsule_id).toBe("cap_1");

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ found: true, capsule: { encryptedPayload: "CIPHERTEXT" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const restored = await client.swarm.restoreCapsule("b".repeat(64));
    expect(restored.found).toBe(true);
    expect(restored.capsule.encryptedPayload).toBe("CIPHERTEXT");
  });

  it("swarm.reportThreat and getThreatRadar work via HTTP", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, report_id: "rep_1", bounty_awarded_angel: 5 }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const rep = await client.swarm.reportThreat({
      reporterCommitment: "c".repeat(64),
      targetDomain: "evil-target.com",
      threatType: "BAN",
      evidenceDigest: "ev_digest",
      signature: "sig",
    });
    expect(rep.bounty_awarded_angel).toBe(5);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ total: 1, threats: [{ targetDomain: "evil-target.com" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const radar = await client.swarm.getThreatRadar({ domain: "evil-target.com" });
    expect(radar.total).toBe(1);
    expect(radar.threats[0].targetDomain).toBe("evil-target.com");
  });

  it("swarm bounty lifecycle methods communicate via HTTP", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, bounty: { id: "bty_1", status: "OPEN" } }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const created = await client.swarm.createBounty({
      creatorCommitment: "a".repeat(64),
      title: "Audit task",
      description: "Review logic",
      rewardAngel: 50,
      signature: "sig",
    });
    expect(created.bounty.id).toBe("bty_1");

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ total: 1, bounties: [{ id: "bty_1" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const list = await client.swarm.listBounties({ status: "OPEN" });
    expect(list.total).toBe(1);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, bounty: { id: "bty_1", status: "CLAIMED" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const claimed = await client.swarm.claimBounty("bty_1", {
      workerCommitment: "w".repeat(64),
      signature: "sig",
    });
    expect(claimed.bounty.status).toBe("CLAIMED");
  });

  describe("client.reserves namespace", () => {
    it("getPoR queries /api/v1/reserves/por with optional query parameters", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            reserve: { total_fine_grams: 50000, merkle_root: "root123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const por = await client.reserves.getPoR({ commodity: "GOLD", batchNumber: "BKO-01" });
      expect(por.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/por?commodity=GOLD&batch=BKO-01");
      expect(init.method).toBe("GET");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer pk_test_secret",
      });
    });

    it("listVaults queries /api/v1/reserves/vaults", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            total_vaults: 1,
            vaults: [{ vault_id: "VAULT-BKO", total_fine_grams: 25000 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const vaults = await client.reserves.listVaults();
      expect(vaults.success).toBe(true);
      expect(vaults.total_vaults).toBe(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/vaults");
    });

    it("getRegimeState queries /api/v1/reserves/state", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            regime: "SOLID",
            belief_score: 0.05,
            damping_fee_bps: 50,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const state = await client.reserves.getRegimeState();
      expect(state.success).toBe(true);
      expect(state.regime).toBe("SOLID");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/state");
    });

    it("listAssays queries /api/v1/reserves/assays with query parameters", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            count: 1,
            assays: [{ certification_number: "CERT-1" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const assays = await client.reserves.listAssays({ batchNumber: "BKO-01", limit: 10 });
      expect(assays.success).toBe(true);
      expect(assays.count).toBe(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/assays?batch=BKO-01&limit=10");
    });

    it("getDividends queries /api/v1/reserves/dividends with limit parameter", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            totals: { total_fees_captured_angel: 100 },
            recent_disbursements: [{ disbursement_id: "disb_1" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const dividends = await client.reserves.getDividends({ limit: 5 });
      expect(dividends.success).toBe(true);
      expect(dividends.totals.total_fees_captured_angel).toBe(100);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/dividends?limit=5");
    });

    it("proposeQuorum POSTs proposal to /api/v1/reserves/quorum/propose", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            proposal: { proposal_id: "PROP-1", action_type: "QUARANTINE_VAULT" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.reserves.proposeQuorum({
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        proposerState: "ML",
      });

      expect(res.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/quorum/propose");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        action_type: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        proposer_state: "ML",
      });
    });

    it("signQuorum POSTs signature to /api/v1/reserves/quorum/sign", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            proposal_id: "PROP-1",
            executed: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.reserves.signQuorum({
        proposalId: "PROP-1",
        signerState: "BF",
        signature: "sig_bf",
      });

      expect(res.success).toBe(true);
      expect(res.executed).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/quorum/sign");
      expect(init.method).toBe("POST");
    });

    it("listQuorumProposals GETs /api/v1/reserves/quorum/proposals", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            count: 1,
            proposals: [{ proposal_id: "PROP-1" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.reserves.listQuorumProposals({ limit: 5 });
      expect(res.success).toBe(true);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/quorum/proposals?limit=5");
    });
  });

  describe("client.escrow namespace", () => {
    const escrowRecord = {
      escrowId: "esc_1",
      status: "HELD",
      buyerCommitment: "a".repeat(64),
      sellerCommitment: "b".repeat(64),
      batchNumber: "BKO-01",
      commodityType: "GOLD",
      fineGrams: 100,
      unitPriceUsd: 75,
      lockedAngel: 100,
      protocolFeeAngel: 3,
    };

    it("createCommodityEscrow POSTs create action with snake_case body", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, escrow: escrowRecord }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );

      await client.escrow.createCommodityEscrow({
        escrowId: "esc_1",
        buyerCommitment: "a".repeat(64),
        sellerCommitment: "b".repeat(64),
        batchNumber: "BKO-01",
        fineGrams: 100,
        unitPriceUsd: 75,
        lockedAngel: 100,
        timeoutHours: 72,
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/escrow");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer pk_test_secret",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(init.body as string)).toEqual({
        action: "create",
        escrow_id: "esc_1",
        buyer_commitment: "a".repeat(64),
        seller_commitment: "b".repeat(64),
        batch_number: "BKO-01",
        fine_grams: 100,
        unit_price_usd: 75,
        locked_angel: 100,
        timeout_hours: 72,
      });
    });

    it("releaseEscrowOnAssay POSTs release action", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, escrow: { ...escrowRecord, status: "RELEASED" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      await client.escrow.releaseEscrowOnAssay({
        escrowId: "esc_1",
        assayCertificationNumber: "CERT-1",
        releaseSignature: "sig",
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/escrow");
      expect(JSON.parse(init.body as string)).toEqual({
        action: "release",
        escrow_id: "esc_1",
        assay_certification_number: "CERT-1",
        release_signature: "sig",
      });
    });

    it("refundEscrowOnTimeout POSTs refund action", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, escrow: { ...escrowRecord, status: "REFUNDED" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      await client.escrow.refundEscrowOnTimeout("esc_1");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/escrow");
      expect(JSON.parse(init.body as string)).toEqual({ action: "refund", escrow_id: "esc_1" });
    });

    it("getEscrow GETs without an Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, escrow: escrowRecord }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      await client.escrow.getEscrow("esc_1");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/escrow?escrow_id=esc_1");
      expect(init.method).toBe("GET");
      expect(init.headers).not.toMatchObject({ Authorization: expect.anything() });
    });

    it("createCommodityEscrow is idempotent on duplicate escrow_id (re-reads existing)", async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Unique constraint" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, escrow: escrowRecord }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );

      const result = await client.escrow.createCommodityEscrow({
        escrowId: "esc_1",
        buyerCommitment: "a".repeat(64),
        sellerCommitment: "b".repeat(64),
        batchNumber: "BKO-01",
        fineGrams: 100,
        unitPriceUsd: 75,
        lockedAngel: 100,
      });

      expect(result.escrow.escrowId).toBe("esc_1");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(secondCall[0]).toBe("https://passport.example.com/api/v1/reserves/escrow?escrow_id=esc_1");
    });
  });

  describe("client.artisanal namespace", () => {
    it("intakeOre POSTs intake payload with Bearer auth", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            receipt: { receipt_number: "ORE-01", payout_angel: 95 },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.artisanal.intakeOre({
        receiptNumber: "ORE-01",
        stationCode: "STN-KEN-01",
        minerCommitment: "m".repeat(64),
        grossWeightGrams: 50.0,
        assayedFineness: 0.90,
        spectrometerSignature: "sig_xrf",
      });

      expect(res.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/artisanal/intake");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        receipt_number: "ORE-01",
        station_code: "STN-KEN-01",
        miner_commitment: "m".repeat(64),
        gross_weight_grams: 50.0,
        assayed_fineness: 0.90,
        spectrometer_signature: "sig_xrf",
      });
    });

    it("listStations GETs /api/v1/reserves/artisanal/stations", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            stations: [{ station_code: "STN-KEN-01" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.artisanal.listStations();
      expect(res.success).toBe(true);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/artisanal/stations");
    });

    it("bridgeDoré POSTs /api/v1/reserves/artisanal/bridge", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            batch: { batch_number: "BKO-AU-REFINED-01" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.artisanal.bridgeDoré({
        receiptNumbers: ["ORE-01", "ORE-02"],
        targetBatchNumber: "BKO-AU-REFINED-01",
        vaultId: "VAULT-BKO",
        custodianName: "SOREM",
        locationCity: "Bamako",
        locationCountry: "ML",
        barSerials: ["BAR-01"],
        refinedGrossGrams: 100.0,
        refinedFineness: 0.9999,
      });

      expect(res.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/artisanal/bridge");
      expect(init.method).toBe("POST");
    });
  });

  describe("client.transit namespace", () => {
    it("dispatch POSTs waybill to /api/v1/reserves/transit/dispatch", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            waybill: { waybill_number: "WAYBILL-01", status: "DISPATCHED" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.transit.dispatch({
        waybillNumber: "WAYBILL-01",
        batchNumber: "BKO-01",
        destinationPortCode: "PORT-LOME-TG",
        originVaultId: "VAULT-BKO",
        carrierCommitment: "c".repeat(64),
        diplomaticSealDigest: "d".repeat(64),
      });

      expect(res.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/transit/dispatch");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        waybill_number: "WAYBILL-01",
        batch_number: "BKO-01",
        destination_port_code: "PORT-LOME-TG",
        origin_vault_id: "VAULT-BKO",
        carrier_commitment: "c".repeat(64),
        diplomatic_seal_digest: "d".repeat(64),
      });
    });

    it("recordCheckpoint POSTs checkpoint to /api/v1/reserves/transit/checkpoint", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            waybill: { waybill_number: "WAYBILL-01", status: "IN_TRANSIT", checkpoints_visited: ["SIKASSO"] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.transit.recordCheckpoint({
        waybillNumber: "WAYBILL-01",
        checkpointName: "SIKASSO",
        inspectorSignature: "sig",
        inspectorPublicKey: "pk",
      });

      expect(res.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/transit/checkpoint");
      expect(init.method).toBe("POST");
    });

    it("recordArrival POSTs arrival to /api/v1/reserves/transit/arrive", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            waybill: { waybill_number: "WAYBILL-01", status: "PORT_ARRIVED" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.transit.recordArrival({
        waybillNumber: "WAYBILL-01",
        portCode: "PORT-LOME-TG",
        enclaveSignature: "sig_enclave",
      });

      expect(res.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/transit/arrive");
      expect(init.method).toBe("POST");
    });

    it("listCorridors GETs /api/v1/reserves/transit/corridors", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            metrics: { activeEnclavesCount: 2 },
            enclaves: [{ port_code: "PORT-LOME-TG" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.transit.listCorridors();
      expect(res.success).toBe(true);
      expect(res.metrics.activeEnclavesCount).toBe(2);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/transit/corridors");
    });
  });

  describe("client.industrial namespace", () => {
    it("recordSmelting POSTs pour telemetry with Bearer auth", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            smelting_run: { run_number: "SMELT-01", royalty_due_angel: 150 },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.industrial.recordSmelting({
        runNumber: "SMELT-01",
        concessionCode: "CONC-ML-FEKOLA",
        grossPouredGrams: 5000.0,
        densityGramsPerCc: 17.5,
        estimatedAuFineness: 0.88,
        hsmSignature: "sig_hsm",
      });

      expect(res.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/industrial/smelt");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        run_number: "SMELT-01",
        concession_code: "CONC-ML-FEKOLA",
        gross_poured_grams: 5000.0,
        density_grams_per_cc: 17.5,
        estimated_au_fineness: 0.88,
        hsm_signature: "sig_hsm",
      });
    });

    it("bridgeDoré POSTs to /api/v1/reserves/industrial/bridge", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            batch: { batch_number: "BKO-AU-REF-01" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.industrial.bridgeDoré({
        runNumbers: ["SMELT-01"],
        targetBatchNumber: "BKO-AU-REF-01",
        vaultId: "VAULT-BKO",
        custodianName: "SOREM",
        locationCity: "Bamako",
        locationCountry: "ML",
        barSerials: ["BAR-01"],
        refinedGrossGrams: 4400.0,
        refinedFineness: 0.9999,
      });

      expect(res.success).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/industrial/bridge");
      expect(init.method).toBe("POST");
    });

    it("listConcessions GETs /api/v1/reserves/industrial/concessions", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            concessions: [{ concession_code: "CONC-ML-FEKOLA" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await client.industrial.listConcessions();
      expect(res.success).toBe(true);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://passport.example.com/api/v1/reserves/industrial/concessions");
    });
  });
});
