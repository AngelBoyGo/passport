type OperationalDomain = "FINANCIAL_CLEARING" | "CUSTOMER_SUPPORT" | "CODE_GENERATION" | "SYSTEM_INTEGRATION";
type ErrorTranche = "DATA_LEAKAGE" | "COMPUTE_TIMEOUT" | "LOGIC_DETECTION" | "SLA_BREACH" | "NONE";
declare const OPERATIONAL_DOMAINS: readonly ["FINANCIAL_CLEARING", "CUSTOMER_SUPPORT", "CODE_GENERATION", "SYSTEM_INTEGRATION"];
declare const ERROR_TRANCHES: readonly ["DATA_LEAKAGE", "COMPUTE_TIMEOUT", "LOGIC_DETECTION", "SLA_BREACH", "NONE"];
/**
 * Runtime guard for OperationalDomain values.
 */
declare function isOperationalDomain(value: unknown): value is OperationalDomain;
/**
 * Runtime guard for ErrorTranche values.
 */
declare function isErrorTranche(value: unknown): value is ErrorTranche;

interface PassportClientOptions {
    apiKey: string;
    baseUrl: string;
}
interface IssueReceiptInput {
    agent_id: string;
    receipt_type: "custody" | "competence";
    input_digest: string;
    authority_scope: string;
    expiry: string;
    prev_receipt_hash?: string;
    domain?: OperationalDomain;
}
type FinalizeStatus = "success" | "refusal" | "null" | "graceful_shutdown" | "timeout" | "failure_tombstone";
interface FinalizeReceiptInput {
    status: FinalizeStatus;
    output_hash?: string;
    refusal_reason?: string;
    terminal_reason?: string;
    error_tranche?: ErrorTranche;
}
interface GateVerifyResult {
    allow_invocation: boolean;
    reason: string;
}
interface SignedReceipt {
    receipt_id: string;
    status: string;
    [key: string]: unknown;
}
interface EvidencePayload {
    task_id?: string;
    digest?: string;
    sha?: string;
    [key: string]: unknown;
}
interface SignEvidenceResult {
    payload: EvidencePayload;
    canonical: string;
    digest: string;
    signature: string;
}
/**
 * HTTP client for Passport receipt and gate APIs.
 */
declare class PassportClient {
    private readonly apiKey;
    private readonly baseUrl;
    constructor(options: PassportClientOptions);
    /**
     * Issue a pending signed receipt (Bearer auth required).
     */
    issueReceipt(input: IssueReceiptInput): Promise<SignedReceipt>;
    /**
     * Finalize a receipt with outcome (Bearer auth required).
     */
    finalizeReceipt(receiptId: string, input: FinalizeReceiptInput): Promise<SignedReceipt>;
    /**
     * Query gate pass for an operator/domain (no auth).
     */
    queryGate(publicOperatorId: string, domain: OperationalDomain): Promise<GateVerifyResult>;
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
    signEvidence(payload: EvidencePayload, signDigest: (digest: string) => Promise<string> | string): Promise<SignEvidenceResult>;
    /**
     * Post signed evidence for an enrolled agent.
     * Requires the agent to be enrolled and the payload to be signed
     * via `signEvidence()`.
     */
    postEvidence(subjectCommitment: string, sourceType: string, payload: EvidencePayload, signature: string, options?: {
        serviceToken?: string;
    }): Promise<{
        event_commitment_hash: string;
    }>;
    private parseJsonResponse;
}

interface MastraAgentLike {
    name?: string;
    generate(input: unknown): Promise<unknown>;
}
interface MastraWorkflowLike {
    name?: string;
    run?(input: unknown): Promise<unknown>;
    execute?(input: unknown): Promise<unknown>;
}
interface MastraPassportMiddlewareOptions {
    domain: OperationalDomain;
    agentId?: string;
    scope?: string;
    getInputDigest?: (input: unknown) => string;
}
/**
 * Maps Mastra/LLM error messages to Passport error tranches.
 */
declare function classifyMastraError(message: string): ErrorTranche;
/**
 * Creates structural Mastra wrappers that anchor and finalize Passport receipts.
 */
declare function createMastraPassportMiddleware(client: PassportClient, options: MastraPassportMiddlewareOptions): {
    wrapAgent<T extends MastraAgentLike>(agent: T): T;
    wrapWorkflow<T extends MastraWorkflowLike>(workflow: T): T;
};

export { type ErrorTranche as E, type FinalizeReceiptInput as F, type GateVerifyResult as G, type IssueReceiptInput as I, type MastraAgentLike as M, OPERATIONAL_DOMAINS as O, PassportClient as P, type SignEvidenceResult as S, ERROR_TRANCHES as a, type EvidencePayload as b, type FinalizeStatus as c, type MastraPassportMiddlewareOptions as d, type MastraWorkflowLike as e, type OperationalDomain as f, type PassportClientOptions as g, type SignedReceipt as h, classifyMastraError as i, createMastraPassportMiddleware as j, isErrorTranche as k, isOperationalDomain as l };
