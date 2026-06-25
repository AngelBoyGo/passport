export { E as ERROR_TRANCHES, a as ErrorTranche, F as FinalizeReceiptInput, b as FinalizeStatus, G as GateVerifyResult, I as IssueReceiptInput, M as MastraAgentLike, c as MastraPassportMiddlewareOptions, d as MastraWorkflowLike, O as OPERATIONAL_DOMAINS, e as OperationalDomain, P as PassportClient, f as PassportClientOptions, S as SignedReceipt, g as classifyMastraError, h as createMastraPassportMiddleware, i as isErrorTranche, j as isOperationalDomain } from './mastra-857FrHzg.js';

declare class PassportHttpError extends Error {
    readonly status?: number;
    readonly responseBody?: unknown;
    constructor(message: string, status?: number, responseBody?: unknown);
}
interface FetchWithRetryOptions {
    timeoutMs?: number;
    maxAttempts?: number;
}
/**
 * Fetch with timeout, exponential backoff on 5xx/network errors, no retry on 4xx.
 */
declare function fetchWithRetry(url: string | URL, init?: RequestInit, options?: FetchWithRetryOptions): Promise<Response>;

export { type FetchWithRetryOptions, PassportHttpError, fetchWithRetry };
