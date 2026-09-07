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
interface SwarmPublishInput {
    agentCommitment: string;
    channel?: string;
    topic: string;
    payload: unknown;
    signature: string;
    parentHash?: string;
    publicKey?: string;
}
interface SwarmQueryInput {
    channel?: string;
    topic?: string;
    agent?: string;
    parentHash?: string;
    since?: string;
    limit?: number;
}
interface SwarmMemoryItem {
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
interface SaveCapsuleInput {
    agentCommitment: string;
    encryptedPayload: string;
    signature: string;
    publicKey?: string;
    ttlHours?: number;
}
interface ReportThreatInput {
    reporterCommitment: string;
    targetDomain: string;
    threatType: string;
    evidenceDigest: string;
    signature: string;
    details?: Record<string, unknown>;
    publicKey?: string;
}
interface SwarmBountyItem {
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
interface CreateBountyParams {
    creatorCommitment: string;
    title: string;
    description: string;
    rewardAngel: number;
    signature: string;
    bountyType?: string;
    publicKey?: string;
}
interface SwarmClient {
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
    getThreatRadar(options?: {
        domain?: string;
        threatType?: string;
        limit?: number;
    }): Promise<{
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
    claimBounty(bountyId: string, params: {
        workerCommitment: string;
        signature: string;
        publicKey?: string;
        timeoutHours?: number;
    }): Promise<{
        success: boolean;
        bounty: SwarmBountyItem;
    }>;
    submitBountyWork(bountyId: string, params: {
        workerCommitment: string;
        deliverableDigest: string;
        signature: string;
        deliverableUrl?: string;
        publicKey?: string;
    }): Promise<{
        success: boolean;
        bounty: SwarmBountyItem;
    }>;
    completeBounty(bountyId: string, params: {
        verifierCommitment: string;
        signature: string;
        publicKey?: string;
    }): Promise<{
        success: boolean;
        bounty: SwarmBountyItem;
        payout_angel: number;
        fee_angel: number;
    }>;
}
interface PoRResponse {
    success: boolean;
    reserve?: {
        commodity_type: string;
        symbol: string;
        total_fine_grams: number;
        encumbered_fine_grams?: number;
        unencumbered_fine_grams?: number;
        total_gross_grams: number;
        active_lots_count: number;
        merkle_root: string;
        last_audited_at: string;
    };
    attestation?: Record<string, unknown>;
    batches?: Array<{
        batch_number: string;
        vault_id: string;
        custodian_name: string;
        location_city: string;
        location_country: string;
        fine_weight_grams: number;
        gross_weight_grams: number;
        fineness: number;
        bar_serials_count: number;
        status: string;
        assay_ref?: string | null;
    }>;
    batch_number?: string;
    leaf_hash?: string;
    merkle_root?: string;
    verified?: boolean;
    proof?: Array<{
        position: "left" | "right";
        hash: string;
    }>;
    disclaimer: string;
}
interface VaultsResponse {
    success: boolean;
    total_vaults: number;
    vaults: Array<{
        vault_id: string;
        custodian_name: string;
        location_city: string;
        location_country: string;
        active_batches_count: number;
        total_fine_grams: number;
        total_gross_grams: number;
        status: string;
        last_audited_at: string | null;
    }>;
}
interface RegimeStateResponse {
    success: boolean;
    regime: "SOLID" | "GHOST";
    belief_score: number;
    damping_fee_bps: number;
    damping_fee_percent: string;
    circuit_breaker_active: boolean;
    revival_eligible: boolean;
    triggers: string[];
    commodities: Array<{
        symbol: string;
        commodity_type: string;
        name: string;
        unit: string;
        price_usd: number;
        change_24h_percent: number;
        volatility_30d_percent: number;
        is_stale: boolean;
        last_updated: string;
    }>;
    basket_valuation: {
        total_gross_usd: number;
        annual_carry_cost_usd: number;
        net_reserve_usd: number;
        backing_ratio: number;
        is_solvent: boolean;
        reserve_floor_price_usd: number;
        composition: Array<Record<string, unknown>>;
    };
    signature: {
        algorithm: string;
        public_key: string;
        signature: string;
    };
    timestamp: string;
    disclaimer: string;
}
interface AssaysResponse {
    success: boolean;
    count: number;
    assays: Array<{
        certification_number: string;
        batch_number: string;
        assayer_name: string;
        assayer_public_key: string;
        methodology: string;
        purity_fineness: number;
        gross_grams: number;
        sample_signature: string;
        notes?: string | null;
        certified_at: string;
    }>;
}
interface DividendsResponse {
    success: boolean;
    totals: {
        total_fees_captured_angel: number;
        national_treasury_angel: number;
        community_trust_angel: number;
        workers_bonus_angel: number;
        treasury_stabilization_angel: number;
        validator_pool_angel: number;
        agent_rebates_angel: number;
        total_disbursement_events: number;
    };
    statutory_formula: {
        standard: string;
        state_tier_percent: string;
        treasury_stabilization_percent: string;
        validators_pool_percent: string;
        agent_rebate_percent: string;
    };
    recent_disbursements: Array<{
        disbursement_id: string;
        escrow_id: string;
        batch_number: string;
        total_fee_angel: number;
        state_national_angel: number;
        state_community_angel: number;
        state_workers_angel: number;
        treasury_stabilization_angel: number;
        validator_pool_angel: number;
        agent_rebate_angel: number;
        district_name: string;
        country_code: string;
        disbursed_at: string;
    }>;
    timestamp: string;
}
interface QuorumProposalInput {
    proposalId?: string;
    actionType: string;
    payload: Record<string, unknown>;
    proposerState: "ML" | "BF" | "NE" | string;
    requiredThreshold?: number;
    ttlHours?: number;
}
interface QuorumProposalResponse {
    success: boolean;
    proposal: {
        proposal_id: string;
        action_type: string;
        payload_digest: string;
        proposer_state: string;
        required_threshold: number;
        status: string;
        expires_at: string;
    };
}
interface QuorumSignInput {
    proposalId: string;
    signerState: "ML" | "BF" | "NE" | string;
    signature: string;
    signerPublicKey?: string;
}
interface QuorumSignResponse {
    success: boolean;
    proposal_id: string;
    signer_state: string;
    total_signatures: number;
    required_threshold: number;
    status: string;
    executed: boolean;
    execution_result?: unknown;
}
interface QuorumProposalsListResponse {
    success: boolean;
    count: number;
    proposals: Array<{
        proposal_id: string;
        action_type: string;
        payload: Record<string, unknown>;
        payload_digest: string;
        proposer_state: string;
        required_threshold: number;
        signature_count: number;
        signatures: Array<{
            signer_state: string;
            signed_at: string;
        }>;
        status: string;
        expires_at: string;
        executed_at?: string | null;
        execution_result?: unknown;
    }>;
    surveillance: {
        states: Array<{
            countryCode: string;
            status: "ONLINE" | "DARK";
            lastSeenAt: string | null;
            silenceHours: number;
        }>;
        isAnyStateDark: boolean;
        deadManAlertTriggered: boolean;
    };
}
interface ReservesClient {
    getPoR(options?: {
        commodity?: string;
        batchNumber?: string;
    }): Promise<PoRResponse>;
    listVaults(): Promise<VaultsResponse>;
    getRegimeState(): Promise<RegimeStateResponse>;
    listAssays(options?: {
        batchNumber?: string;
        limit?: number;
    }): Promise<AssaysResponse>;
    getDividends(options?: {
        limit?: number;
    }): Promise<DividendsResponse>;
    proposeQuorum(input: QuorumProposalInput): Promise<QuorumProposalResponse>;
    signQuorum(input: QuorumSignInput): Promise<QuorumSignResponse>;
    listQuorumProposals(options?: {
        limit?: number;
    }): Promise<QuorumProposalsListResponse>;
}
type CommodityEscrowStatus = "HELD" | "RELEASED" | "DISPUTED" | "REFUNDED";
interface CommodityEscrowRecord {
    escrowId: string;
    status: CommodityEscrowStatus;
    buyerCommitment: string;
    sellerCommitment: string;
    batchNumber: string;
    commodityType: string;
    fineGrams: number;
    unitPriceUsd: number;
    lockedAngel: number;
    protocolFeeAngel: number;
    assayCertificationNumber?: string | null;
    releaseSignature?: string | null;
    releasedAt?: string | null;
    timeoutAt: string;
    createdAt: string;
    updatedAt: string;
}
interface CreateEscrowInput {
    escrowId: string;
    buyerCommitment: string;
    sellerCommitment: string;
    batchNumber: string;
    fineGrams: number;
    unitPriceUsd: number;
    lockedAngel: number;
    commodityType?: string;
    timeoutHours?: number;
}
interface ReleaseEscrowInput {
    escrowId: string;
    assayCertificationNumber: string;
    releaseSignature: string;
}
interface ReservesEscrowClient {
    createCommodityEscrow(input: CreateEscrowInput): Promise<{
        success: boolean;
        escrow: CommodityEscrowRecord;
    }>;
    releaseEscrowOnAssay(input: ReleaseEscrowInput): Promise<{
        success: boolean;
        escrow: CommodityEscrowRecord;
    }>;
    refundEscrowOnTimeout(escrowId: string): Promise<{
        success: boolean;
        escrow: CommodityEscrowRecord;
    }>;
    getEscrow(escrowId: string): Promise<{
        success: boolean;
        escrow: CommodityEscrowRecord;
    }>;
}
interface OreIntakeInput {
    receiptNumber: string;
    stationCode: string;
    minerCommitment: string;
    grossWeightGrams: number;
    assayedFineness: number;
    spectrometerSignature: string;
    payoutRatePercent?: number;
}
interface OreIntakeResponse {
    success: boolean;
    receipt: {
        receipt_number: string;
        station_code: string;
        miner_commitment: string;
        gross_weight_grams: number;
        assayed_fineness: number;
        fine_gold_grams: number;
        payout_usd: number;
        payout_angel: number;
        status: string;
        created_at: string;
    };
    payout_details: {
        spot_price_usd_per_gram: number;
        payout_rate_percent: number;
        fine_grams: number;
        payout_usd: number;
        payout_angel: number;
    };
}
interface ArtisanalStationsResponse {
    success: boolean;
    metrics: {
        totalBuyingStations: number;
        activeStations: number;
        totalIntakeReceipts: number;
        totalGrossGramsFormalized: number;
        totalFineGramsFormalized: number;
        totalAngelPaidToMiners: number;
        receiptsRefinedToBullion: number;
        receiptsInTransit: number;
    };
    stations: Array<{
        station_code: string;
        station_name: string;
        country_code: string;
        district_name: string;
        operator_commitment: string;
        station_public_key: string;
        bonded_stake_angel: number;
        active_status: string;
        total_purchased_grams: number;
        total_paid_angel: number;
    }>;
}
interface BridgeDoreClientInput {
    receiptNumbers: string[];
    targetBatchNumber: string;
    vaultId: string;
    custodianName: string;
    locationCity: string;
    locationCountry: string;
    barSerials: string[];
    refinedGrossGrams: number;
    refinedFineness: number;
}
interface BridgeDoreResponse {
    success: boolean;
    batch: {
        batch_number: string;
        vault_id: string;
        custodian_name: string;
        gross_weight_grams: number;
        fineness: number;
        fine_weight_grams: number;
        status: string;
    };
    refined_metrics: {
        receipts_refined_count: number;
        total_raw_fine_grams: number;
        refined_fine_grams: number;
        new_reserve_merkle_root: string;
    };
}
interface ArtisanalClient {
    intakeOre(input: OreIntakeInput): Promise<OreIntakeResponse>;
    listStations(): Promise<ArtisanalStationsResponse>;
    bridgeDoré(input: BridgeDoreClientInput): Promise<BridgeDoreResponse>;
}
interface DispatchTransitClientInput {
    waybillNumber: string;
    batchNumber: string;
    destinationPortCode: string;
    originVaultId: string;
    carrierCommitment: string;
    carrierBondAngel?: number;
    diplomaticSealDigest: string;
}
interface DispatchTransitResponse {
    success: boolean;
    waybill: {
        waybill_number: string;
        batch_number: string;
        destination_port_code: string;
        carrier_commitment: string;
        carrier_bond_angel: number;
        fine_gold_grams: number;
        status: string;
        dispatched_at: string;
    };
}
interface TransitCheckpointClientInput {
    waybillNumber: string;
    checkpointName: string;
    inspectorSignature: string;
    inspectorPublicKey: string;
}
interface TransitArrivalClientInput {
    waybillNumber: string;
    portCode: string;
    enclaveSignature: string;
    enclavePublicKey?: string;
}
interface TransitCorridorsResponse {
    success: boolean;
    metrics: {
        activeEnclavesCount: number;
        activeWaybillsCount: number;
        transitFineGoldGrams: number;
        totalCarrierBondsLockedAngel: number;
        totalConvoysArrived: number;
        totalBreachesDetected: number;
    };
    enclaves: Array<{
        port_code: string;
        port_name: string;
        country_code: string;
        customs_authority_name: string;
        clearing_fee_share_bps: number;
        total_transit_grams: number;
        total_fees_earned_angel: number;
        active_status: string;
    }>;
    recent_waybills: Array<{
        waybill_number: string;
        batch_number: string;
        destination_port_code: string;
        carrier_commitment: string;
        carrier_bond_angel: number;
        fine_gold_grams: number;
        status: string;
        checkpoints_visited: string[];
        dispatched_at: string;
        arrived_at?: string | null;
    }>;
    timestamp: string;
}
interface TransitClient {
    dispatch(input: DispatchTransitClientInput): Promise<DispatchTransitResponse>;
    recordCheckpoint(input: TransitCheckpointClientInput): Promise<{
        success: boolean;
        waybill: {
            waybill_number: string;
            status: string;
            checkpoints_visited: string[];
        };
    }>;
    recordArrival(input: TransitArrivalClientInput): Promise<{
        success: boolean;
        waybill: {
            waybill_number: string;
            status: string;
            arrived_at?: string | null;
        };
    }>;
    listCorridors(): Promise<TransitCorridorsResponse>;
}
interface RecordSmeltInput {
    runNumber: string;
    concessionCode: string;
    grossPouredGrams: number;
    densityGramsPerCc: number;
    estimatedAuFineness: number;
    estimatedAgFineness?: number;
    hsmSignature: string;
    hsmPublicKey?: string;
}
interface SmeltingRunResponse {
    success: boolean;
    smelting_run: {
        run_number: string;
        concession_code: string;
        gross_poured_grams: number;
        fine_gold_grams: number;
        fine_silver_grams: number;
        gross_market_value_usd: number;
        royalty_due_angel: number;
        state_share_due_angel: number;
        status: string;
        poured_at: string;
    };
    royalty_calculation: Record<string, unknown>;
}
interface BridgeIndustrialClientInput {
    runNumbers: string[];
    targetBatchNumber: string;
    vaultId: string;
    custodianName: string;
    locationCity: string;
    locationCountry: string;
    barSerials: string[];
    refinedGrossGrams: number;
    refinedFineness: number;
}
interface IndustrialConcessionsResponse {
    success: boolean;
    metrics: {
        activeConcessionsCount: number;
        totalSmeltingRunsCount: number;
        totalGrossPouredGrams: number;
        totalFineGoldGrams: number;
        totalMarketValueUsd: number;
        totalRoyaltiesCapturedAngel: number;
        totalStateEquityAngel: number;
        runsRefinedToBullion: number;
        runsInTransit: number;
    };
    concessions: Array<{
        concession_code: string;
        concession_name: string;
        country_code: string;
        district_name: string;
        operator_company: string;
        statutory_royalty_percent: number;
        state_participation_percent: number;
        smelter_hsm_public_key: string;
        active_status: string;
        total_poured_grams: number;
        total_royalties_angel: number;
    }>;
    timestamp: string;
}
interface IndustrialClient {
    recordSmelting(input: RecordSmeltInput): Promise<SmeltingRunResponse>;
    bridgeDoré(input: BridgeIndustrialClientInput): Promise<BridgeDoreResponse>;
    listConcessions(): Promise<IndustrialConcessionsResponse>;
}
interface VerifyMilestoneClientInput {
    disbursementId: string;
    verifierSignature: string;
    verifierPublicKey: string;
    mediaDigest: string;
    verificationDescription?: string;
    jobsCreated?: number;
    realizedImpactKwh?: number;
}
interface RegFundClientInput {
    projectCode: string;
    projectName: string;
    category: string;
    countryCode: string;
    districtName: string;
    operatorCommitment: string;
    allocatedAngel: number;
    totalMilestones?: number;
    expectedJobs?: number;
    declaredImpactKwh?: number;
}
interface RegisterProjectResponse {
    success: boolean;
    project: {
        project_code: string;
        project_name: string;
        category: string;
        country_code: string;
        status: string;
        allocated_angel: number;
        total_milestones: number;
    };
}
interface RegisterProjectResponse {
    success: boolean;
    project: {
        project_code: string;
        project_name: string;
        category: string;
        country_code: string;
        status: string;
        allocated_angel: number;
        total_milestones: number;
    };
}
interface FundProjectsListResponse {
    success: boolean;
    metrics: {
        activeProjectsCount: number;
        totalProjects: number;
        totalDeployedAngel: number;
        totalJobsCreated: number;
        totalCompletedMilestones: number;
        totalRealizedImpactKwh: number;
        balance: {
            totalBalance: number;
            coldHibernationReserve: number;
            deployableBalance: number;
        };
        solvency: {
            totalBalance: number;
            coldHibernationReserve: number;
            deployableBalance: number;
            totalAllocatedAngel: number;
            deployedInRolling365d: number;
            bufferSolvent: boolean;
        };
    };
    projects: Array<{
        project_code: string;
        project_name: string;
        category: string;
        country_code: string;
        district_name: string;
        status: string;
        allocated_angel: number;
        total_milestones: number;
        completed_milestones: number;
        jobs_created: number;
        realized_impact_kwh: number;
    }>;
    timestamp: string;
}
interface FundClient {
    registerProject(input: RegFundClientInput): Promise<RegisterProjectResponse>;
    listProjects(): Promise<FundProjectsListResponse>;
    verifyMilestone(input: VerifyMilestoneClientInput): Promise<{
        success: boolean;
        is_complete: boolean;
    }>;
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
    readonly swarm: SwarmClient;
    readonly reserves: ReservesClient;
    readonly escrow: ReservesEscrowClient;
    readonly artisanal: ArtisanalClient;
    readonly transit: TransitClient;
    readonly industrial: IndustrialClient;
    readonly fund: FundClient;
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

export { type SwarmMemoryItem as $, type ArtisanalClient as A, type BridgeDoreClientInput as B, type CommodityEscrowRecord as C, type DispatchTransitClientInput as D, type ErrorTranche as E, type FinalizeReceiptInput as F, type GateVerifyResult as G, type QuorumSignResponse as H, type IndustrialClient as I, type RegFundClientInput as J, type RegimeStateResponse as K, type RegisterProjectResponse as L, type MastraAgentLike as M, type ReleaseEscrowInput as N, OPERATIONAL_DOMAINS as O, PassportClient as P, type QuorumProposalInput as Q, type RecordSmeltInput as R, type ReportThreatInput as S, type ReservesClient as T, type ReservesEscrowClient as U, type SaveCapsuleInput as V, type SignEvidenceResult as W, type SignedReceipt as X, type SmeltingRunResponse as Y, type SwarmBountyItem as Z, type SwarmClient as _, type ArtisanalStationsResponse as a, type SwarmPublishInput as a0, type SwarmQueryInput as a1, type TransitArrivalClientInput as a2, type TransitCheckpointClientInput as a3, type TransitClient as a4, type TransitCorridorsResponse as a5, type VaultsResponse as a6, type VerifyMilestoneClientInput as a7, classifyMastraError as a8, createMastraPassportMiddleware as a9, isErrorTranche as aa, isOperationalDomain as ab, type AssaysResponse as b, type BridgeDoreResponse as c, type BridgeIndustrialClientInput as d, type CommodityEscrowStatus as e, type CreateBountyParams as f, type CreateEscrowInput as g, type DispatchTransitResponse as h, type DividendsResponse as i, ERROR_TRANCHES as j, type EvidencePayload as k, type FinalizeStatus as l, type FundClient as m, type FundProjectsListResponse as n, type IndustrialConcessionsResponse as o, type IssueReceiptInput as p, type MastraPassportMiddlewareOptions as q, type MastraWorkflowLike as r, type OperationalDomain as s, type OreIntakeInput as t, type OreIntakeResponse as u, type PassportClientOptions as v, type PoRResponse as w, type QuorumProposalResponse as x, type QuorumProposalsListResponse as y, type QuorumSignInput as z };
