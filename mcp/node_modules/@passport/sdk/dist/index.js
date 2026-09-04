"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ERROR_TRANCHES: () => ERROR_TRANCHES,
  OPERATIONAL_DOMAINS: () => OPERATIONAL_DOMAINS,
  PassportCallbackHandler: () => PassportCallbackHandler,
  PassportClient: () => PassportClient,
  PassportHttpError: () => PassportHttpError,
  classifyExecutionError: () => classifyExecutionError,
  classifyMastraError: () => classifyMastraError,
  createMastraPassportMiddleware: () => createMastraPassportMiddleware,
  fetchWithRetry: () => fetchWithRetry,
  isErrorTranche: () => isErrorTranche,
  isOperationalDomain: () => isOperationalDomain,
  passportMiddleware: () => passportMiddleware,
  withPassportAudit: () => withPassportAudit
});
module.exports = __toCommonJS(index_exports);

// src/http.ts
var PassportHttpError = class extends Error {
  status;
  responseBody;
  constructor(message, status, responseBody) {
    super(message);
    this.name = "PassportHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
};
var DEFAULT_BACKOFF_MS = [200, 400, 800];
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return void 0;
  }
}
async function fetchWithRetry(url, init, options = {}) {
  const timeoutMs = options.timeoutMs ?? 4e3;
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await globalThis.fetch(url, {
        ...init,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.status >= 400 && response.status < 500) {
        return response;
      }
      if (response.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await sleep(DEFAULT_BACKOFF_MS[attempt] ?? 800);
          continue;
        }
        throw new PassportHttpError(
          `HTTP ${response.status}`,
          response.status,
          await safeJson(response)
        );
      }
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof PassportHttpError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await sleep(DEFAULT_BACKOFF_MS[attempt] ?? 800);
        continue;
      }
    }
  }
  throw new PassportHttpError(
    lastError?.message ?? "Request failed after retries",
    void 0,
    void 0
  );
}

// src/client.ts
function canonicalJson(obj) {
  const sorted = Object.keys(obj).sort();
  const ordered = {};
  for (const key of sorted) ordered[key] = obj[key];
  return JSON.stringify(ordered);
}
async function sha256Hex(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var PassportClient = class {
  apiKey;
  baseUrl;
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }
  /**
   * Issue a pending signed receipt (Bearer auth required).
   */
  async issueReceipt(input) {
    const response = await fetchWithRetry(`${this.baseUrl}/api/v1/receipts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(input)
    });
    return this.parseJsonResponse(response);
  }
  /**
   * Finalize a receipt with outcome (Bearer auth required).
   */
  async finalizeReceipt(receiptId, input) {
    const response = await fetchWithRetry(
      `${this.baseUrl}/api/v1/receipts/${receiptId}/finalize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(input)
      }
    );
    return this.parseJsonResponse(response);
  }
  /**
   * Query gate pass for an operator/domain (no auth).
   */
  async queryGate(publicOperatorId, domain) {
    const response = await fetchWithRetry(`${this.baseUrl}/api/v1/gate/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        operator_id: publicOperatorId,
        domain
      })
    });
    return this.parseJsonResponse(response);
  }
  /**
   * Sign an evidence payload and produce the canonical digest + signature.
   *
   * The `signDigest` function receives the 64-hex SHA-256 digest of the
   * canonical JSON and must return the Ed25519 signature as a 128-hex string.
   *
   * Example with @noble/ed25519:
   * ```ts
   * const { sign } = await import("@noble/ed25519");
   * const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils");
   * const result = await client.signEvidence(
   *   { task_id: "abc", digest: "64hex..." },
   *   async (digest) => bytesToHex(await sign(utf8ToBytes(digest), hexToBytes(privateKey)))
   * );
   * ```
   */
  async signEvidence(payload, signDigest) {
    const canonical = canonicalJson(payload);
    const digest = await sha256Hex(canonical);
    const signature = await signDigest(digest);
    return { payload, canonical, digest, signature };
  }
  /**
   * Post signed evidence for an enrolled agent.
   * Requires the agent to be enrolled and the payload to be signed
   * via `signEvidence()`.
   */
  async postEvidence(subjectCommitment, sourceType, payload, signature, options) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (options?.serviceToken) {
      headers.Authorization = `Bearer ${options.serviceToken}`;
    }
    const response = await fetchWithRetry(
      `${this.baseUrl}/api/v1/passport/agents/${subjectCommitment}/evidence`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_type: sourceType, payload, signature })
      }
    );
    return this.parseJsonResponse(response);
  }
  async parseJsonResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new PassportHttpError(message, response.status, body);
    }
    return body;
  }
};

// src/enums.ts
var OPERATIONAL_DOMAINS = [
  "FINANCIAL_CLEARING",
  "CUSTOMER_SUPPORT",
  "CODE_GENERATION",
  "SYSTEM_INTEGRATION"
];
var ERROR_TRANCHES = [
  "DATA_LEAKAGE",
  "COMPUTE_TIMEOUT",
  "LOGIC_DETECTION",
  "SLA_BREACH",
  "NONE"
];
function isOperationalDomain(value) {
  return typeof value === "string" && OPERATIONAL_DOMAINS.includes(value);
}
function isErrorTranche(value) {
  return typeof value === "string" && ERROR_TRANCHES.includes(value);
}

// src/middleware/mastra.ts
var import_node_crypto = require("crypto");
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function sha256Hex2(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
}
function defaultInputDigest(input) {
  return sha256Hex2(JSON.stringify(input ?? null));
}
function defaultExpiry(now = Date.now()) {
  return new Date(now + THIRTY_DAYS_MS).toISOString();
}
function hashOutput(output) {
  return sha256Hex2(JSON.stringify(output ?? null));
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

// src/middleware/audit.ts
var import_node_crypto2 = require("crypto");
function sha256Hex3(value) {
  return (0, import_node_crypto2.createHash)("sha256").update(value).digest("hex");
}
function classifyExecutionError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("rate limit") || lower.includes("token limit") || lower.includes("429")) {
    return "COMPUTE_TIMEOUT";
  }
  if (lower.includes("schema") || lower.includes("validation") || lower.includes("parse") || lower.includes("type error")) {
    return "LOGIC_DETECTION";
  }
  return "SLA_BREACH";
}
function withPassportAudit(fn, options) {
  return async (...args) => {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();
    const inputDigest = sha256Hex3(JSON.stringify(args));
    let output;
    let executionError;
    try {
      output = await fn(...args);
    } catch (err) {
      executionError = err instanceof Error ? err : new Error(String(err));
      const endMs2 = Date.now();
      const finishedAt2 = new Date(endMs2).toISOString();
      if (options.signDigest) {
        try {
          const payload = {
            task_id: `fail-${startMs}`,
            digest: inputDigest,
            error_classification: classifyExecutionError(executionError.message),
            observed_at: finishedAt2
          };
          const { signature } = await options.client.signEvidence(payload, options.signDigest);
          const result = await options.client.postEvidence(
            options.subjectCommitment,
            options.sourceType ?? "task_deliverable",
            payload,
            signature,
            { serviceToken: options.serviceToken }
          );
          options.onAuditComplete?.({
            eventCommitmentHash: result.event_commitment_hash,
            latencyMs: endMs2 - startMs,
            error: executionError
          });
        } catch {
        }
      }
      throw executionError;
    }
    const endMs = Date.now();
    const finishedAt = new Date(endMs).toISOString();
    const outputDigest = sha256Hex3(JSON.stringify(output ?? null));
    if (options.signDigest) {
      try {
        const payload = {
          task_id: `task-${startMs}`,
          digest: outputDigest,
          observed_at: finishedAt
        };
        const { signature } = await options.client.signEvidence(payload, options.signDigest);
        const result = await options.client.postEvidence(
          options.subjectCommitment,
          options.sourceType ?? "task_deliverable",
          payload,
          signature,
          { serviceToken: options.serviceToken }
        );
        options.onAuditComplete?.({
          eventCommitmentHash: result.event_commitment_hash,
          latencyMs: endMs - startMs
        });
      } catch {
      }
    }
    return output;
  };
}

// src/vercel-ai.ts
function passportMiddleware(config) {
  const baseUrl = config.baseUrl || "https://passport.metis.gold";
  const sourceType = config.sourceType || "otel_genai_trace";
  return {
    onGenerate: async ({ operation }) => {
      const startTime = Date.now();
      const inputDigest = await sha256Hex4(operation.input[0]?.text || "");
      return {
        onFinish: async (result) => {
          const outputText = result.text || "";
          const outputDigest = await sha256Hex4(outputText);
          const payload = {
            task_id: `gen_${inputDigest.slice(0, 16)}`,
            digest: outputDigest,
            input_digest: inputDigest,
            model: operation.model || "unknown",
            duration_ms: Date.now() - startTime,
            token_usage_input: result.usage?.promptTokens || 0,
            token_usage_output: result.usage?.completionTokens || 0,
            finish_reason: result.finishReason || "unknown",
            observed_at: (/* @__PURE__ */ new Date()).toISOString()
          };
          try {
            await fetch(`${baseUrl}/api/v1/passport/agents/${config.commitment}/evidence`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`
              },
              body: JSON.stringify({
                source_type: sourceType,
                payload,
                signature: "0".repeat(128)
              })
            });
          } catch {
          }
        }
      };
    }
  };
}
async function sha256Hex4(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/langchain.ts
var PassportCallbackHandler = class {
  config;
  baseUrl;
  startTimes = /* @__PURE__ */ new Map();
  constructor(config) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://passport.metis.gold";
  }
  name = "PassportCallbackHandler";
  async handleLLMStart(llm, prompts, runId) {
    this.startTimes.set(runId, Date.now());
  }
  async handleLLMEnd(output, runId) {
    const startTime = this.startTimes.get(runId);
    if (!startTime) return;
    this.startTimes.delete(runId);
    const outputText = output.generations?.[0]?.[0]?.text || "";
    const inputText = "";
    const durationMs = Date.now() - startTime;
    const tokenUsage = output.llmOutput?.tokenUsage || {};
    const payload = {
      task_id: `langchain_${runId.slice(0, 12)}`,
      digest: await sha256Hex5(outputText),
      model: "langchain",
      duration_ms: durationMs,
      token_usage_input: tokenUsage.promptTokens || 0,
      token_usage_output: tokenUsage.completionTokens || 0,
      finish_reason: "stop",
      observed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await fetch(`${this.baseUrl}/api/v1/passport/agents/${this.config.commitment}/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          source_type: "otel_genai_trace",
          payload,
          signature: "0".repeat(128)
        })
      });
    } catch {
    }
  }
  async handleLLMError(_err, runId) {
    this.startTimes.delete(runId);
  }
};
async function sha256Hex5(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ERROR_TRANCHES,
  OPERATIONAL_DOMAINS,
  PassportCallbackHandler,
  PassportClient,
  PassportHttpError,
  classifyExecutionError,
  classifyMastraError,
  createMastraPassportMiddleware,
  fetchWithRetry,
  isErrorTranche,
  isOperationalDomain,
  passportMiddleware,
  withPassportAudit
});
