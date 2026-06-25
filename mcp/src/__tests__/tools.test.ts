import { describe, expect, it, vi } from "vitest";
import type { PassportClient } from "@passport/sdk";
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
});
