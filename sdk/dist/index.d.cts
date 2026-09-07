import { P as PassportClient, E as ErrorTranche } from './mastra-DKGEyAoQ.cjs';
export { A as ArtisanalClient, a as ArtisanalStationsResponse, b as AssaysResponse, B as BridgeDoreClientInput, c as BridgeDoreResponse, d as BridgeIndustrialClientInput, C as CommodityEscrowRecord, e as CommodityEscrowStatus, f as CreateBountyParams, g as CreateEscrowInput, D as DispatchTransitClientInput, h as DispatchTransitResponse, i as DividendsResponse, j as ERROR_TRANCHES, k as EvidencePayload, F as FinalizeReceiptInput, l as FinalizeStatus, m as FundClient, n as FundProjectsListResponse, G as GateVerifyResult, I as IndustrialClient, o as IndustrialConcessionsResponse, p as IssueReceiptInput, M as MastraAgentLike, q as MastraPassportMiddlewareOptions, r as MastraWorkflowLike, O as OPERATIONAL_DOMAINS, s as OperationalDomain, t as OreIntakeInput, u as OreIntakeResponse, v as PassportClientOptions, w as PoRResponse, Q as QuorumProposalInput, x as QuorumProposalResponse, y as QuorumProposalsListResponse, z as QuorumSignInput, H as QuorumSignResponse, R as RecordSmeltInput, J as RegFundClientInput, K as RegimeStateResponse, L as RegisterProjectResponse, N as ReleaseEscrowInput, S as ReportThreatInput, T as ReservesClient, U as ReservesEscrowClient, V as SaveCapsuleInput, W as SignEvidenceResult, X as SignedReceipt, Y as SmeltingRunResponse, Z as SwarmBountyItem, _ as SwarmClient, $ as SwarmMemoryItem, a0 as SwarmPublishInput, a1 as SwarmQueryInput, a2 as TransitArrivalClientInput, a3 as TransitCheckpointClientInput, a4 as TransitClient, a5 as TransitCorridorsResponse, a6 as VaultsResponse, a7 as VerifyMilestoneClientInput, a8 as classifyMastraError, a9 as createMastraPassportMiddleware, aa as isErrorTranche, ab as isOperationalDomain } from './mastra-DKGEyAoQ.cjs';
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
