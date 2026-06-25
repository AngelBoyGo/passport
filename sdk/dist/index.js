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
  PassportClient: () => PassportClient,
  PassportHttpError: () => PassportHttpError,
  classifyMastraError: () => classifyMastraError,
  createMastraPassportMiddleware: () => createMastraPassportMiddleware,
  fetchWithRetry: () => fetchWithRetry,
  isErrorTranche: () => isErrorTranche,
  isOperationalDomain: () => isOperationalDomain
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
function sha256Hex(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ERROR_TRANCHES,
  OPERATIONAL_DOMAINS,
  PassportClient,
  PassportHttpError,
  classifyMastraError,
  createMastraPassportMiddleware,
  fetchWithRetry,
  isErrorTranche,
  isOperationalDomain
});
