import { createHash } from "node:crypto";
import type { PassportClient } from "../client.js";
import type { ErrorTranche, OperationalDomain } from "../enums.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface MastraAgentLike {
  name?: string;
  generate(input: unknown): Promise<unknown>;
}

export interface MastraWorkflowLike {
  name?: string;
  run?(input: unknown): Promise<unknown>;
  execute?(input: unknown): Promise<unknown>;
}

export interface MastraPassportMiddlewareOptions {
  domain: OperationalDomain;
  agentId?: string;
  scope?: string;
  getInputDigest?: (input: unknown) => string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function defaultInputDigest(input: unknown): string {
  return sha256Hex(JSON.stringify(input ?? null));
}

function defaultExpiry(now: number = Date.now()): string {
  return new Date(now + THIRTY_DAYS_MS).toISOString();
}

function hashOutput(output: unknown): string {
  return sha256Hex(JSON.stringify(output ?? null));
}

/**
 * Maps Mastra/LLM error messages to Passport error tranches.
 */
export function classifyMastraError(message: string): ErrorTranche {
  const lower = message.toLowerCase();

  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("rate limit") ||
    lower.includes("context length") ||
    lower.includes("max tokens")
  ) {
    return "COMPUTE_TIMEOUT";
  }

  if (
    lower.includes("file validation") ||
    lower.includes("schema mutation") ||
    lower.includes("validation failed")
  ) {
    return "LOGIC_DETECTION";
  }

  return "SLA_BREACH";
}

async function runWithReceipt<T>(
  client: PassportClient,
  options: MastraPassportMiddlewareOptions,
  input: unknown,
  agentLabel: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const receipt = await client.issueReceipt({
    agent_id: options.agentId ?? agentLabel ?? "mastra-agent",
    receipt_type: "competence",
    input_digest: (options.getInputDigest ?? defaultInputDigest)(input),
    authority_scope: options.scope ?? "mastra.middleware",
    expiry: defaultExpiry(),
    domain: options.domain,
  });

  try {
    const output = await fn();
    await client.finalizeReceipt(receipt.receipt_id, {
      status: "success",
      output_hash: hashOutput(output),
    });
    return output;
  } catch (err) {
    const terminalReason =
      err instanceof Error ? err.message : "Unhandled Mastra failure";
    await client.finalizeReceipt(receipt.receipt_id, {
      status: "failure_tombstone",
      error_tranche: classifyMastraError(terminalReason),
      terminal_reason: terminalReason,
    });
    throw err;
  }
}

/**
 * Creates structural Mastra wrappers that anchor and finalize Passport receipts.
 */
export function createMastraPassportMiddleware(
  client: PassportClient,
  options: MastraPassportMiddlewareOptions
) {
  return {
    wrapAgent<T extends MastraAgentLike>(agent: T): T {
      const original = agent.generate.bind(agent);
      return {
        ...agent,
        generate: (input: unknown) =>
          runWithReceipt(client, options, input, agent.name, () =>
            original(input)
          ),
      };
    },

    wrapWorkflow<T extends MastraWorkflowLike>(workflow: T): T {
      const method = workflow.execute ?? workflow.run;
      if (!method) {
        throw new Error("MastraWorkflowLike requires run or execute");
      }

      const original = method.bind(workflow);
      const wrappedMethod = (input: unknown) =>
        runWithReceipt(client, options, input, workflow.name, () =>
          original(input)
        );

      if (workflow.execute) {
        return { ...workflow, execute: wrappedMethod };
      }

      return { ...workflow, run: wrappedMethod };
    },
  };
}
