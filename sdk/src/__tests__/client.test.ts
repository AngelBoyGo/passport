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
    globalThis.fetch = fetchMock;
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
});
