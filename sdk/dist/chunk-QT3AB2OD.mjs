// src/middleware/mastra.ts
import { createHash } from "crypto";
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function defaultInputDigest(input) {
  return sha256Hex(JSON.stringify(input ?? null));
}
function defaultExpiry(now = Date.now()) {
  return new Date(now + THIRTY_DAYS_MS).toISOString();
}
function hashOutput(output) {
  return sha256Hex(JSON.stringify(output ?? null));
}
function classifyMastraError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("rate limit") || lower.includes("context length") || lower.includes("max tokens")) {
    return "COMPUTE_TIMEOUT";
  }
  if (lower.includes("file validation") || lower.includes("schema mutation") || lower.includes("validation failed")) {
    return "LOGIC_DETECTION";
  }
  return "SLA_BREACH";
}
async function runWithReceipt(client, options, input, agentLabel, fn) {
  const receipt = await client.issueReceipt({
    agent_id: options.agentId ?? agentLabel ?? "mastra-agent",
    receipt_type: "competence",
    input_digest: (options.getInputDigest ?? defaultInputDigest)(input),
    authority_scope: options.scope ?? "mastra.middleware",
    expiry: defaultExpiry(),
    domain: options.domain
  });
  try {
    const output = await fn();
    await client.finalizeReceipt(receipt.receipt_id, {
      status: "success",
      output_hash: hashOutput(output)
    });
    return output;
  } catch (err) {
    const terminalReason = err instanceof Error ? err.message : "Unhandled Mastra failure";
    await client.finalizeReceipt(receipt.receipt_id, {
      status: "failure_tombstone",
      error_tranche: classifyMastraError(terminalReason),
      terminal_reason: terminalReason
    });
    throw err;
  }
}
function createMastraPassportMiddleware(client, options) {
  return {
    wrapAgent(agent) {
      const original = agent.generate.bind(agent);
      return {
        ...agent,
        generate: (input) => runWithReceipt(
          client,
          options,
          input,
          agent.name,
          () => original(input)
        )
      };
    },
    wrapWorkflow(workflow) {
      const method = workflow.execute ?? workflow.run;
      if (!method) {
        throw new Error("MastraWorkflowLike requires run or execute");
      }
      const original = method.bind(workflow);
      const wrappedMethod = (input) => runWithReceipt(
        client,
        options,
        input,
        workflow.name,
        () => original(input)
      );
      if (workflow.execute) {
        return { ...workflow, execute: wrappedMethod };
      }
      return { ...workflow, run: wrappedMethod };
    }
  };
}

export {
  classifyMastraError,
  createMastraPassportMiddleware
};
