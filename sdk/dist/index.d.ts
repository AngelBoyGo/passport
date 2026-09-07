import { P as PassportClient, E as ErrorTranche } from './mastra-9rjJtYoY.js';
export { A as ArtisanalClient, a as ArtisanalStationsResponse, b as AssaysResponse, B as BridgeDoreClientInput, c as BridgeDoreResponse, C as CommodityEscrowRecord, d as CommodityEscrowStatus, e as CreateBountyParams, f as CreateEscrowInput, D as DispatchTransitClientInput, g as DispatchTransitResponse, h as DividendsResponse, i as ERROR_TRANCHES, j as EvidencePayload, F as FinalizeReceiptInput, k as FinalizeStatus, G as GateVerifyResult, I as IssueReceiptInput, M as MastraAgentLike, l as MastraPassportMiddlewareOptions, m as MastraWorkflowLike, O as OPERATIONAL_DOMAINS, n as OperationalDomain, o as OreIntakeInput, p as OreIntakeResponse, q as PassportClientOptions, r as PoRResponse, Q as QuorumProposalInput, s as QuorumProposalResponse, t as QuorumProposalsListResponse, u as QuorumSignInput, v as QuorumSignResponse, R as RegimeStateResponse, w as ReleaseEscrowInput, x as ReportThreatInput, y as ReservesClient, z as ReservesEscrowClient, S as SaveCapsuleInput, H as SignEvidenceResult, J as SignedReceipt, K as SwarmBountyItem, L as SwarmClient, N as SwarmMemoryItem, T as SwarmPublishInput, U as SwarmQueryInput, V as TransitArrivalClientInput, W as TransitCheckpointClientInput, X as TransitClient, Y as TransitCorridorsResponse, Z as VaultsResponse, _ as classifyMastraError, $ as createMastraPassportMiddleware, a0 as isErrorTranche, a1 as isOperationalDomain } from './mastra-9rjJtYoY.js';
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
