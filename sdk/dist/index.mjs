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
export {
  ERROR_TRANCHES,
  OPERATIONAL_DOMAINS,
  PassportClient,
  PassportHttpError,
  classifyMastraError,
  createMastraPassportMiddleware,
  fetchWithRetry,
  isErrorTranche,
  isOperationalDomain
};
