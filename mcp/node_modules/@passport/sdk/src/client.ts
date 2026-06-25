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
