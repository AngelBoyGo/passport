import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PassportClient } from "../client.js";
import type { OperationalDomain } from "../enums.js";
import {
  classifyMastraError,
  createMastraPassportMiddleware,
  type MastraAgentLike,
  type MastraWorkflowLike,
} from "../middleware/mastra.js";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("classifyMastraError", () => {
  const cases: Array<[string, string]> = [
    ["LLM request timed out after 30s", "COMPUTE_TIMEOUT"],
    ["Rate limit exceeded for model gpt-4", "COMPUTE_TIMEOUT"],
    ["Context length overflow: max tokens exceeded", "COMPUTE_TIMEOUT"],
    ["File validation failed: unsupported mime type", "LOGIC_DETECTION"],
    ["Schema mutation detected in tool output", "LOGIC_DETECTION"],
    ["Unexpected internal server error", "SLA_BREACH"],
  ];

  it.each(cases)("maps %j -> %s", (message, expected) => {
    expect(classifyMastraError(message)).toBe(expected);
  });
});

describe("createMastraPassportMiddleware", () => {
  const domain: OperationalDomain = "CODE_GENERATION";
  let issueReceipt: ReturnType<typeof vi.fn>;
  let finalizeReceipt: ReturnType<typeof vi.fn>;
  let client: PassportClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));

    issueReceipt = vi.fn().mockResolvedValue({
      receipt_id: "rcpt_mastra_1",
      status: "pending",
    });
    finalizeReceipt = vi.fn().mockResolvedValue({
      receipt_id: "rcpt_mastra_1",
      status: "success",
    });

    client = {
      issueReceipt,
      finalizeReceipt,
      queryGate: vi.fn(),
    } as unknown as PassportClient;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("wrapAgent issues receipt, runs generate, finalizes success on happy path", async () => {
    const middleware = createMastraPassportMiddleware(client, {
      domain,
      agentId: "agent-mastra",
      scope: "mastra.test",
      getInputDigest: (input) => sha256Hex(JSON.stringify(input)),
    });

    const agent: MastraAgentLike = {
      name: "test-agent",
      async generate(input) {
        return { echoed: input };
      },
    };

    const wrapped = middleware.wrapAgent(agent);
    const result = await wrapped.generate({ prompt: "hello" });

    expect(result).toEqual({ echoed: { prompt: "hello" } });
    expect(issueReceipt).toHaveBeenCalledOnce();
    expect(issueReceipt).toHaveBeenCalledWith({
      agent_id: "agent-mastra",
      receipt_type: "competence",
      input_digest: sha256Hex(JSON.stringify({ prompt: "hello" })),
      authority_scope: "mastra.test",
      expiry: "2026-07-14T12:00:00.000Z",
      domain,
    });
    expect(finalizeReceipt).toHaveBeenCalledOnce();
    expect(finalizeReceipt).toHaveBeenCalledWith("rcpt_mastra_1", {
      status: "success",
      output_hash: sha256Hex(JSON.stringify({ echoed: { prompt: "hello" } })),
    });
  });

  it("wrapWorkflow runs execute and finalizes success", async () => {
    const middleware = createMastraPassportMiddleware(client, { domain });

    const workflow: MastraWorkflowLike = {
      name: "wf-1",
      async execute(input) {
        return { done: input };
      },
    };

    const wrapped = middleware.wrapWorkflow(workflow);
    const result = await wrapped.execute!("step-a");

    expect(result).toEqual({ done: "step-a" });
    expect(finalizeReceipt).toHaveBeenCalledWith("rcpt_mastra_1", {
      status: "success",
      output_hash: sha256Hex(JSON.stringify({ done: "step-a" })),
    });
  });

  it("wrapAgent finalizes failure_tombstone with mapped tranche and rethrows", async () => {
    const middleware = createMastraPassportMiddleware(client, { domain });
    const rawMessage = "Context length overflow: max tokens exceeded";

    const agent: MastraAgentLike = {
      async generate() {
        throw new Error(rawMessage);
      },
    };

    const wrapped = middleware.wrapAgent(agent);

    await expect(wrapped.generate({})).rejects.toThrow(rawMessage);

    expect(finalizeReceipt).toHaveBeenCalledOnce();
    expect(finalizeReceipt).toHaveBeenCalledWith("rcpt_mastra_1", {
      status: "failure_tombstone",
      error_tranche: "COMPUTE_TIMEOUT",
      terminal_reason: rawMessage,
    });
  });
});
