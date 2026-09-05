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

export interface SwarmPublishInput {
  agentCommitment: string;
  channel?: string;
  topic: string;
  payload: unknown;
  signature: string;
  parentHash?: string;
  publicKey?: string;
}

export interface SwarmQueryInput {
  channel?: string;
  topic?: string;
  agent?: string;
  parentHash?: string;
  since?: string;
  limit?: number;
}

export interface SwarmMemoryItem {
  id: string;
  agentCommitment: string;
  channel: string;
  topic: string;
  payload: unknown;
  payloadDigest: string;
  signature: string;
  parentHash: string | null;
  merkleRoot: string | null;
  feeDeducted: number;
  createdAt: string;
  verified: boolean;
}

export interface SaveCapsuleInput {
  agentCommitment: string;
  encryptedPayload: string;
  signature: string;
  publicKey?: string;
  ttlHours?: number;
}

export interface ReportThreatInput {
  reporterCommitment: string;
  targetDomain: string;
  threatType: string;
  evidenceDigest: string;
  signature: string;
  details?: Record<string, unknown>;
  publicKey?: string;
}

export interface SwarmBountyItem {
  id: string;
  creatorCommitment: string;
  workerCommitment: string | null;
  title: string;
  description: string;
  bountyType: string;
  rewardAngel: number;
  feeAngel: number;
  status: string;
  deliverableDigest: string | null;
  deliverableUrl: string | null;
  workerSignature: string | null;
  claimExpiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBountyParams {
  creatorCommitment: string;
  title: string;
  description: string;
  rewardAngel: number;
  signature: string;
  bountyType?: string;
  publicKey?: string;
}

export interface SwarmClient {
  publish(input: SwarmPublishInput): Promise<{
    success: boolean;
    memory_id: string;
    agent_commitment: string;
    channel: string;
    topic: string;
    payload_digest: string;
    created_at: string;
    verified: boolean;
    fee_deducted: number;
  }>;
  recall(query?: SwarmQueryInput): Promise<{
    channel: string;
    total: number;
    memories: SwarmMemoryItem[];
  }>;
  saveCapsule(input: SaveCapsuleInput): Promise<{
    success: boolean;
    capsule_id: string;
    agent_commitment: string;
    version: number;
    expires_at: string;
  }>;
  restoreCapsule(agentCommitment: string): Promise<{
    found: boolean;
    agent_commitment: string;
    capsule: {
      version: number;
      encryptedPayload: string;
      payloadDigest: string;
      signature: string;
      expiresAt: string;
      updatedAt: string;
    };
  }>;
  reportThreat(input: ReportThreatInput): Promise<{
    success: boolean;
    report_id: string;
    threat_type: string;
    bounty_awarded_angel: number;
  }>;
  getThreatRadar(options?: { domain?: string; threatType?: string; limit?: number }): Promise<{
    total: number;
    threats: Array<{
      id: string;
      targetDomain: string;
      threatType: string;
      details: unknown;
      createdAt: string;
    }>;
  }>;
  createBounty(params: CreateBountyParams): Promise<{
    success: boolean;
    bounty: SwarmBountyItem;
  }>;
  listBounties(filter?: {
    status?: string;
    bountyType?: string;
    creator?: string;
    worker?: string;
    minReward?: number;
    limit?: number;
  }): Promise<{
    total: number;
    bounties: SwarmBountyItem[];
  }>;
  claimBounty(
    bountyId: string,
    params: { workerCommitment: string; signature: string; publicKey?: string; timeoutHours?: number }
  ): Promise<{
    success: boolean;
    bounty: SwarmBountyItem;
  }>;
  submitBountyWork(
    bountyId: string,
    params: {
      workerCommitment: string;
      deliverableDigest: string;
      signature: string;
      deliverableUrl?: string;
      publicKey?: string;
    }
  ): Promise<{
    success: boolean;
    bounty: SwarmBountyItem;
  }>;
  completeBounty(
    bountyId: string,
    params: { verifierCommitment: string; signature: string; publicKey?: string }
  ): Promise<{
    success: boolean;
    bounty: SwarmBountyItem;
    payout_angel: number;
    fee_angel: number;
  }>;
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
  public readonly swarm: SwarmClient;

  constructor(options: PassportClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");

    this.swarm = {
      publish: async (input: SwarmPublishInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/memory`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            agent_commitment: input.agentCommitment,
            channel: input.channel,
            topic: input.topic,
            payload: input.payload,
            signature: input.signature,
            parent_hash: input.parentHash,
            public_key: input.publicKey,
          }),
        });
        return this.parseJsonResponse(response);
      },

      recall: async (query?: SwarmQueryInput) => {
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
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      saveCapsule: async (input: SaveCapsuleInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/capsule`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            agent_commitment: input.agentCommitment,
            encrypted_payload: input.encryptedPayload,
            signature: input.signature,
            public_key: input.publicKey,
            ttl_hours: input.ttlHours,
          }),
        });
        return this.parseJsonResponse(response);
      },

      restoreCapsule: async (agentCommitment: string) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/capsule/${agentCommitment}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          }
        );
        return this.parseJsonResponse(response);
      },

      reportThreat: async (input: ReportThreatInput) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/radar/report`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              reporter_commitment: input.reporterCommitment,
              target_domain: input.targetDomain,
              threat_type: input.threatType,
              details: input.details,
              evidence_digest: input.evidenceDigest,
              signature: input.signature,
              public_key: input.publicKey,
            }),
          }
        );
        return this.parseJsonResponse(response);
      },

      getThreatRadar: async (options?: { domain?: string; threatType?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (options?.domain) params.set("domain", options.domain);
        if (options?.threatType) params.set("threat_type", options.threatType);
        if (options?.limit) params.set("limit", String(options.limit));

        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/swarm/radar/active-threats${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      createBounty: async (params: CreateBountyParams) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/bounties`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            creator_commitment: params.creatorCommitment,
            title: params.title,
            description: params.description,
            reward_angel: params.rewardAngel,
            signature: params.signature,
            bounty_type: params.bountyType,
            public_key: params.publicKey,
          }),
        });
        return this.parseJsonResponse(response);
      },

      listBounties: async (filter?: {
        status?: string;
        bountyType?: string;
        creator?: string;
        worker?: string;
        minReward?: number;
        limit?: number;
      }) => {
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
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      claimBounty: async (
        bountyId: string,
        params: { workerCommitment: string; signature: string; publicKey?: string; timeoutHours?: number }
      ) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/claim`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              worker_commitment: params.workerCommitment,
              signature: params.signature,
              public_key: params.publicKey,
              timeout_hours: params.timeoutHours,
            }),
          }
        );
        return this.parseJsonResponse(response);
      },

      submitBountyWork: async (
        bountyId: string,
        params: {
          workerCommitment: string;
          deliverableDigest: string;
          signature: string;
          deliverableUrl?: string;
          publicKey?: string;
        }
      ) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/submit`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              worker_commitment: params.workerCommitment,
              deliverable_digest: params.deliverableDigest,
              deliverable_url: params.deliverableUrl,
              signature: params.signature,
              public_key: params.publicKey,
            }),
          }
        );
        return this.parseJsonResponse(response);
      },

      completeBounty: async (
        bountyId: string,
        params: { verifierCommitment: string; signature: string; publicKey?: string }
      ) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/complete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              verifier_commitment: params.verifierCommitment,
              signature: params.signature,
              public_key: params.publicKey,
            }),
          }
        );
        return this.parseJsonResponse(response);
      },
    };
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
