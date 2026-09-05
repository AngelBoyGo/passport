import {
  PassportCallbackHandler
} from "./chunk-IYK2UBNZ.mjs";
import {
  passportMiddleware
} from "./chunk-O33WCM4W.mjs";
import {
  classifyMastraError,
  createMastraPassportMiddleware
} from "./chunk-QT3AB2OD.mjs";

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
  swarm;
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.swarm = {
      publish: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/memory`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            agent_commitment: input.agentCommitment,
            channel: input.channel,
            topic: input.topic,
            payload: input.payload,
            signature: input.signature,
            parent_hash: input.parentHash,
            public_key: input.publicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      recall: async (query) => {
        const params = new URLSearchParams();
        if (query?.channel) params.set("channel", query.channel);
        if (query?.topic) params.set("topic", query.topic);
        if (query?.agent) params.set("agent", query.agent);
        if (query?.parentHash) params.set("parent_hash", query.parentHash);
        if (query?.since) params.set("since", query.since);
        if (query?.limit) params.set("limit", String(query.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/swarm/memory${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      saveCapsule: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/capsule`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            agent_commitment: input.agentCommitment,
            encrypted_payload: input.encryptedPayload,
            signature: input.signature,
            public_key: input.publicKey,
            ttl_hours: input.ttlHours
          })
        });
        return this.parseJsonResponse(response);
      },
      restoreCapsule: async (agentCommitment) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/capsule/${agentCommitment}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${this.apiKey}`
            }
          }
        );
        return this.parseJsonResponse(response);
      },
      reportThreat: async (input) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/radar/report`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              reporter_commitment: input.reporterCommitment,
              target_domain: input.targetDomain,
              threat_type: input.threatType,
              details: input.details,
              evidence_digest: input.evidenceDigest,
              signature: input.signature,
              public_key: input.publicKey
            })
          }
        );
        return this.parseJsonResponse(response);
      },
      getThreatRadar: async (options2) => {
        const params = new URLSearchParams();
        if (options2?.domain) params.set("domain", options2.domain);
        if (options2?.threatType) params.set("threat_type", options2.threatType);
        if (options2?.limit) params.set("limit", String(options2.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/swarm/radar/active-threats${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      createBounty: async (params) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/bounties`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            creator_commitment: params.creatorCommitment,
            title: params.title,
            description: params.description,
            reward_angel: params.rewardAngel,
            signature: params.signature,
            bounty_type: params.bountyType,
            public_key: params.publicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      listBounties: async (filter) => {
        const params = new URLSearchParams();
        if (filter?.status) params.set("status", filter.status);
        if (filter?.bountyType) params.set("bounty_type", filter.bountyType);
        if (filter?.creator) params.set("creator", filter.creator);
        if (filter?.worker) params.set("worker", filter.worker);
        if (filter?.minReward) params.set("min_reward", String(filter.minReward));
        if (filter?.limit) params.set("limit", String(filter.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/swarm/bounties${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      claimBounty: async (bountyId, params) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/claim`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              worker_commitment: params.workerCommitment,
              signature: params.signature,
              public_key: params.publicKey,
              timeout_hours: params.timeoutHours
            })
          }
        );
        return this.parseJsonResponse(response);
      },
      submitBountyWork: async (bountyId, params) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/submit`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              worker_commitment: params.workerCommitment,
              deliverable_digest: params.deliverableDigest,
              deliverable_url: params.deliverableUrl,
              signature: params.signature,
              public_key: params.publicKey
            })
          }
        );
        return this.parseJsonResponse(response);
      },
      completeBounty: async (bountyId, params) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/complete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              verifier_commitment: params.verifierCommitment,
              signature: params.signature,
              public_key: params.publicKey
            })
          }
        );
        return this.parseJsonResponse(response);
      }
    };
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

// src/middleware/audit.ts
import { createHash } from "crypto";
function sha256Hex2(value) {
  return createHash("sha256").update(value).digest("hex");
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
    const inputDigest = sha256Hex2(JSON.stringify(args));
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
    const outputDigest = sha256Hex2(JSON.stringify(output ?? null));
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
export {
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
};
