import { describe, it, expect, vi, beforeEach } from "vitest";

const { issueReceiptMock, finalizeReceiptMock } = vi.hoisted(() => ({
  issueReceiptMock: vi.fn(),
  finalizeReceiptMock: vi.fn(),
}));

vi.mock("@/lib/receipt-service", () => ({
  issueReceipt: issueReceiptMock,
  finalizeReceipt: finalizeReceiptMock,
}));

import { ErrorTranche, OperationalDomain } from "@prisma/client";
import { validateFinalizeInput } from "@/lib/receipt/finalize";
import {
  type AgentTraceSpan,
  classifyTraceFault,
  ingestTraceBatch,
  ingestTraceSpan,
  mapTraceToReceiptPlan,
  resolveAgentIdentity,
  resolveDomain,
} from "@/ingest/trace-adapter";

describe("resolveAgentIdentity", () => {
  it("prefers structured agent.id", () => {
    expect(resolveAgentIdentity({ agent: { id: "aider-bot" } })).toBe(
      "aider-bot"
    );
  });

  it("handles multi-format identifiers via attributes", () => {
    expect(
      resolveAgentIdentity({ attributes: { "gen_ai.agent.id": "sweep-1" } })
    ).toBe("sweep-1");
    expect(
      resolveAgentIdentity({ attributes: { "service.name": "svc-agent" } })
    ).toBe("svc-agent");
    expect(resolveAgentIdentity({ name: "span-named-agent" })).toBe(
      "span-named-agent"
    );
  });

  it("falls back to a stable sentinel for legacy identity-less spans", () => {
    expect(resolveAgentIdentity({})).toBe("agent_unknown");
    expect(resolveAgentIdentity({ agent: { id: "   " } })).toBe("agent_unknown");
  });
});

describe("resolveDomain", () => {
  it("honors an explicit valid enum domain", () => {
    expect(resolveDomain({ domain: "FINANCIAL_CLEARING" })).toBe(
      OperationalDomain.FINANCIAL_CLEARING
    );
  });

  it("infers domain from workload context keywords", () => {
    expect(resolveDomain({ name: "open pull request and run CI" })).toBe(
      OperationalDomain.CODE_GENERATION
    );
    expect(resolveDomain({ name: "settle invoice payment" })).toBe(
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(
      resolveDomain({ attributes: { task: "answer customer ticket" } })
    ).toBe(OperationalDomain.CUSTOMER_SUPPORT);
  });

  it("defaults legacy/unknown workloads to SYSTEM_INTEGRATION", () => {
    expect(resolveDomain({ name: "unlabeled task" })).toBe(
      OperationalDomain.SYSTEM_INTEGRATION
    );
    expect(resolveDomain({ domain: "NOT_A_REAL_DOMAIN" })).toBe(
      OperationalDomain.SYSTEM_INTEGRATION
    );
  });
});

describe("classifyTraceFault", () => {
  it("maps resource-class faults to COMPUTE_TIMEOUT", () => {
    expect(classifyTraceFault("Request timed out after 30s")).toBe(
      ErrorTranche.COMPUTE_TIMEOUT
    );
    expect(classifyTraceFault("token limit exhausted")).toBe(
      ErrorTranche.COMPUTE_TIMEOUT
    );
    expect(classifyTraceFault("HTTP 429 rate limit")).toBe(
      ErrorTranche.COMPUTE_TIMEOUT
    );
  });

  it("maps logic/compile/handoff faults to LOGIC_DETECTION", () => {
    expect(classifyTraceFault("Traceback: SyntaxError in module")).toBe(
      ErrorTranche.LOGIC_DETECTION
    );
    expect(classifyTraceFault("circular handoff stall detected")).toBe(
      ErrorTranche.LOGIC_DETECTION
    );
  });

  it("defaults unknown errors to LOGIC_DETECTION", () => {
    expect(classifyTraceFault(undefined)).toBe(ErrorTranche.LOGIC_DETECTION);
    expect(classifyTraceFault("something unexpected happened")).toBe(
      ErrorTranche.LOGIC_DETECTION
    );
  });
});

describe("mapTraceToReceiptPlan", () => {
  it("maps OK spans to a success receipt with output hash + NONE tranche", () => {
    const plan = mapTraceToReceiptPlan({
      agent: { id: "aider" },
      name: "wrote code and passed CI",
      status: { code: "OK" },
      output: { merged: true },
    });
    expect(plan.agent_id).toBe("aider");
    expect(plan.domain).toBe(OperationalDomain.CODE_GENERATION);
    expect(plan.finalize.status).toBe("success");
    expect(plan.finalize.output_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.finalize.error_tranche).toBe(ErrorTranche.NONE);
    expect(validateFinalizeInput(plan.finalize).valid).toBe(true);
  });

  it("maps timeout ERROR spans to a terminal timeout receipt", () => {
    const plan = mapTraceToReceiptPlan({
      agent: { id: "crawler" },
      status: { code: "ERROR", message: "deadline exceeded / timed out" },
    });
    expect(plan.finalize.status).toBe("timeout");
    expect(plan.finalize.error_tranche).toBe(ErrorTranche.COMPUTE_TIMEOUT);
    expect(plan.finalize.terminal_reason).toMatch(/^[0-9a-f]{64}$/);
    expect(validateFinalizeInput(plan.finalize).valid).toBe(true);
  });

  it("maps logic ERROR spans to a failure tombstone receipt", () => {
    const plan = mapTraceToReceiptPlan({
      agent: { id: "sweep" },
      status: { code: "ERROR", message: "compilation crash: SyntaxError" },
    });
    expect(plan.finalize.status).toBe("failure_tombstone");
    expect(plan.finalize.error_tranche).toBe(ErrorTranche.LOGIC_DETECTION);
    expect(validateFinalizeInput(plan.finalize).valid).toBe(true);
  });

  it("maps UNSET/ambiguous spans to a null receipt", () => {
    const plan = mapTraceToReceiptPlan({ agent: { id: "x" } });
    expect(plan.finalize.status).toBe("null");
    expect(plan.finalize.refusal_reason).toMatch(/^[0-9a-f]{64}$/);
    expect(validateFinalizeInput(plan.finalize).valid).toBe(true);
  });

  it("never emits plaintext input/output (hash-only)", () => {
    const secret = "sensitive prompt body";
    const plan = mapTraceToReceiptPlan({
      agent: { id: "x" },
      input: secret,
      status: { code: "OK" },
      output: "secret output",
    });
    expect(plan.input_digest).not.toContain(secret);
    expect(plan.input_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ingestTraceSpan / ingestTraceBatch", () => {
  beforeEach(() => {
    issueReceiptMock.mockReset();
    finalizeReceiptMock.mockReset();
    issueReceiptMock.mockImplementation(async () => ({
      signed: { receipt_id: "rcpt_pending" },
    }));
    finalizeReceiptMock.mockImplementation(async () => ({
      signed: { receipt_id: "rcpt_final" },
    }));
  });

  it("issues a custody receipt anchored to the consenting operator", async () => {
    const span: AgentTraceSpan = {
      agent: { id: "aider" },
      name: "merge PR",
      status: { code: "OK" },
      source: "agentlogs",
    };
    const result = await ingestTraceSpan("op-db-1", span, {
      stripeCustomerId: "cus_partner_1",
      blind: true,
    });

    expect(result.receipt_id).toBe("rcpt_final");
    expect(issueReceiptMock).toHaveBeenCalledWith(
      "op-db-1",
      expect.objectContaining({
        operator_id: "op_cus_partner_1",
        agent_id: "aider",
        receipt_type: "custody",
        domain: OperationalDomain.CODE_GENERATION,
        blind: true,
        authority_scope: "ingest.trace.agentlogs",
      })
    );
    expect(finalizeReceiptMock).toHaveBeenCalledWith(
      "op-db-1",
      "rcpt_pending",
      expect.objectContaining({ status: "success" })
    );
  });

  it("ingests a batch without dropping any span", async () => {
    const spans: AgentTraceSpan[] = [
      { agent: { id: "a" }, status: { code: "OK" } },
      { agent: { id: "b" }, status: { code: "ERROR", message: "timeout" } },
      { agent: { id: "c" }, status: { code: "ERROR", message: "SyntaxError" } },
      { agent: { id: "d" } },
    ];
    const results = await ingestTraceBatch("op-db-1", spans, {
      stripeCustomerId: "cus_partner_1",
    });

    expect(results).toHaveLength(spans.length);
    expect(issueReceiptMock).toHaveBeenCalledTimes(spans.length);
    expect(finalizeReceiptMock).toHaveBeenCalledTimes(spans.length);
  });
});
