import type { ErrorTranche, OperationalDomain } from "./enums.js";
import { fetchWithRetry, PassportHttpError } from "./http.js";

export interface PassportClientOptions {
  apiKey: string;
  baseUrl: string;
}

export interface IssueReceiptInput {
  agent_id: string;
  receipt_type: "custody" | "competence";
  input_digest: string;
  authority_scope: string;
  expiry: string;
  prev_receipt_hash?: string;
  domain?: OperationalDomain;
}

export type FinalizeStatus =
  | "success"
  | "refusal"
  | "null"
  | "graceful_shutdown"
  | "timeout"
  | "failure_tombstone";

export interface FinalizeReceiptInput {
  status: FinalizeStatus;
  output_hash?: string;
  refusal_reason?: string;
  terminal_reason?: string;
  error_tranche?: ErrorTranche;
}

export interface GateVerifyResult {
  allow_invocation: boolean;
  reason: string;
}

export interface SignedReceipt {
  receipt_id: string;
  status: string;
  [key: string]: unknown;
}

export interface EvidencePayload {
  task_id?: string;
  digest?: string;
  sha?: string;
  [key: string]: unknown;
}

export interface SignEvidenceResult {
  payload: EvidencePayload;
  canonical: string;
  digest: string;
  signature: string;
}

/**
 * Canonical JSON: sorted keys, compact separators.
 * Must match the server's canonicalJson() in canonical.ts.
 */
function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of sorted) ordered[key] = obj[key];
  return JSON.stringify(ordered);
}

/**
 * SHA-256 hex digest of a UTF-8 string. Uses Web Crypto when available
 * (Node 20+, modern browsers), falls back to a simple hash.
 */
async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HTTP client for Passport receipt and gate APIs.
 */
export class PassportClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: PassportClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  /**
   * Issue a pending signed receipt (Bearer auth required).
   */
  async issueReceipt(input: IssueReceiptInput): Promise<SignedReceipt> {
    const response = await fetchWithRetry(`${this.baseUrl}/api/v1/receipts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(input),
    });
    return this.parseJsonResponse(response);
  }

  /**
   * Finalize a receipt with outcome (Bearer auth required).
   */
  async finalizeReceipt(
    receiptId: string,
    input: FinalizeReceiptInput
  ): Promise<SignedReceipt> {
    const response = await fetchWithRetry(
      `${this.baseUrl}/api/v1/receipts/${receiptId}/finalize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(input),
      }
    );
    return this.parseJsonResponse(response);
  }

  /**
   * Query gate pass for an operator/domain (no auth).
   */
  async queryGate(
    publicOperatorId: string,
    domain: OperationalDomain
  ): Promise<GateVerifyResult> {
    const response = await fetchWithRetry(`${this.baseUrl}/api/v1/gate/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operator_id: publicOperatorId,
        domain,
      }),
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
  async signEvidence(
    payload: EvidencePayload,
    signDigest: (digest: string) => Promise<string> | string
  ): Promise<SignEvidenceResult> {
    const canonical = canonicalJson(payload as Record<string, unknown>);
    const digest = await sha256Hex(canonical);
    const signature = await signDigest(digest);
    return { payload, canonical, digest, signature };
  }

  /**
   * Post signed evidence for an enrolled agent.
   * Requires the agent to be enrolled and the payload to be signed
   * via `signEvidence()`.
   */
  async postEvidence(
    subjectCommitment: string,
    sourceType: string,
    payload: EvidencePayload,
    signature: string,
    options?: { serviceToken?: string }
  ): Promise<{ event_commitment_hash: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options?.serviceToken) {
      headers.Authorization = `Bearer ${options.serviceToken}`;
    }
    const response = await fetchWithRetry(
      `${this.baseUrl}/api/v1/passport/agents/${subjectCommitment}/evidence`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_type: sourceType, payload, signature }),
      }
    );
    return this.parseJsonResponse(response);
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : `HTTP ${response.status}`;
      throw new PassportHttpError(message, response.status, body);
    }
    return body as T;
  }
}
