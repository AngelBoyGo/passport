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

export { ERROR_TRANCHES as E, type FinalizeReceiptInput as F, type GateVerifyResult as G, type IssueReceiptInput as I, type MastraAgentLike as M, OPERATIONAL_DOMAINS as O, PassportClient as P, type SignedReceipt as S, type ErrorTranche as a, type FinalizeStatus as b, type MastraPassportMiddlewareOptions as c, type MastraWorkflowLike as d, type OperationalDomain as e, type PassportClientOptions as f, classifyMastraError as g, createMastraPassportMiddleware as h, isErrorTranche as i, isOperationalDomain as j };
