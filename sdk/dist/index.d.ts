import { P as PassportClient, E as ErrorTranche } from './mastra-BYzTK2nX.js';
export { C as CreateBountyParams, a as ERROR_TRANCHES, b as EvidencePayload, F as FinalizeReceiptInput, c as FinalizeStatus, G as GateVerifyResult, I as IssueReceiptInput, M as MastraAgentLike, d as MastraPassportMiddlewareOptions, e as MastraWorkflowLike, O as OPERATIONAL_DOMAINS, f as OperationalDomain, g as PassportClientOptions, R as ReportThreatInput, S as SaveCapsuleInput, h as SignEvidenceResult, i as SignedReceipt, j as SwarmBountyItem, k as SwarmClient, l as SwarmMemoryItem, m as SwarmPublishInput, n as SwarmQueryInput, o as classifyMastraError, p as createMastraPassportMiddleware, q as isErrorTranche, r as isOperationalDomain } from './mastra-BYzTK2nX.js';
export { PassportVercelConfig, passportMiddleware } from './vercel-ai.js';
export { PassportCallbackHandler, PassportLangChainConfig } from './langchain.js';

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

interface PassportAuditOptions {
    client: PassportClient;
    subjectCommitment: string;
    sourceType?: string;
    signDigest?: (digest: string) => Promise<string> | string;
    serviceToken?: string;
    onAuditComplete?: (result: {
        eventCommitmentHash?: string;
        latencyMs: number;
        error?: Error;
    }) => void;
}
/**
 * Classifies uncaught runtime exceptions into typed Passport ErrorTranches.
 */
declare function classifyExecutionError(message: string): ErrorTranche;
/**
 * Higher-order interceptor for async AI agent functions.
 * Captures execution timing, hashes inputs/outputs deterministically,
 * classifies runtime exceptions, and posts signed evidence to Passport.
 */
declare function withPassportAudit<TArgs extends unknown[], TReturn>(fn: (...args: TArgs) => Promise<TReturn>, options: PassportAuditOptions): (...args: TArgs) => Promise<TReturn>;

export { ErrorTranche, type FetchWithRetryOptions, type PassportAuditOptions, PassportClient, PassportHttpError, classifyExecutionError, fetchWithRetry, withPassportAudit };
