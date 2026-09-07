import { P as PassportClient, E as ErrorTranche } from './mastra-9eSQpM0v.cjs';
export { A as ArtisanalClient, a as ArtisanalStationsResponse, b as AssaysResponse, B as BridgeDoreClientInput, c as BridgeDoreResponse, C as CommodityEscrowRecord, d as CommodityEscrowStatus, e as CreateBountyParams, f as CreateEscrowInput, D as DividendsResponse, g as ERROR_TRANCHES, h as EvidencePayload, F as FinalizeReceiptInput, i as FinalizeStatus, G as GateVerifyResult, I as IssueReceiptInput, M as MastraAgentLike, j as MastraPassportMiddlewareOptions, k as MastraWorkflowLike, O as OPERATIONAL_DOMAINS, l as OperationalDomain, m as OreIntakeInput, n as OreIntakeResponse, o as PassportClientOptions, p as PoRResponse, Q as QuorumProposalInput, q as QuorumProposalResponse, r as QuorumProposalsListResponse, s as QuorumSignInput, t as QuorumSignResponse, R as RegimeStateResponse, u as ReleaseEscrowInput, v as ReportThreatInput, w as ReservesClient, x as ReservesEscrowClient, S as SaveCapsuleInput, y as SignEvidenceResult, z as SignedReceipt, H as SwarmBountyItem, J as SwarmClient, K as SwarmMemoryItem, L as SwarmPublishInput, N as SwarmQueryInput, V as VaultsResponse, T as classifyMastraError, U as createMastraPassportMiddleware, W as isErrorTranche, X as isOperationalDomain } from './mastra-9eSQpM0v.cjs';
export { PassportVercelConfig, passportMiddleware } from './vercel-ai.cjs';
export { PassportCallbackHandler, PassportLangChainConfig } from './langchain.cjs';

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
