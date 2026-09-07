import { P as PassportClient, E as ErrorTranche } from './mastra-DCNKWlTJ.cjs';
export { A as ArtisanalClient, a as ArtisanalStationsResponse, b as AssaysResponse, B as BridgeDoreClientInput, c as BridgeDoreResponse, d as BridgeIndustrialClientInput, C as CommodityEscrowRecord, e as CommodityEscrowStatus, f as CreateBountyParams, g as CreateEscrowInput, D as DispatchTransitClientInput, h as DispatchTransitResponse, i as DividendsResponse, j as ERROR_TRANCHES, k as EvidencePayload, F as FinalizeReceiptInput, l as FinalizeStatus, G as GateVerifyResult, I as IndustrialClient, m as IndustrialConcessionsResponse, n as IssueReceiptInput, M as MastraAgentLike, o as MastraPassportMiddlewareOptions, p as MastraWorkflowLike, O as OPERATIONAL_DOMAINS, q as OperationalDomain, r as OreIntakeInput, s as OreIntakeResponse, t as PassportClientOptions, u as PoRResponse, Q as QuorumProposalInput, v as QuorumProposalResponse, w as QuorumProposalsListResponse, x as QuorumSignInput, y as QuorumSignResponse, R as RecordSmeltInput, z as RegimeStateResponse, H as ReleaseEscrowInput, J as ReportThreatInput, K as ReservesClient, L as ReservesEscrowClient, S as SaveCapsuleInput, N as SignEvidenceResult, T as SignedReceipt, U as SmeltingRunResponse, V as SwarmBountyItem, W as SwarmClient, X as SwarmMemoryItem, Y as SwarmPublishInput, Z as SwarmQueryInput, _ as TransitArrivalClientInput, $ as TransitCheckpointClientInput, a0 as TransitClient, a1 as TransitCorridorsResponse, a2 as VaultsResponse, a3 as classifyMastraError, a4 as createMastraPassportMiddleware, a5 as isErrorTranche, a6 as isOperationalDomain } from './mastra-DCNKWlTJ.cjs';
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
