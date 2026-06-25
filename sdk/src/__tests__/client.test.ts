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
});
