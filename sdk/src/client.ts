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

export interface PoRResponse {
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
  proof?: Array<{ position: "left" | "right"; hash: string }>;
  disclaimer: string;
}

export interface VaultsResponse {
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

export interface RegimeStateResponse {
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

export interface AssaysResponse {
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

export interface DividendsResponse {
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

export interface QuorumProposalInput {
  proposalId?: string;
  actionType: string;
  payload: Record<string, unknown>;
  proposerState: "ML" | "BF" | "NE" | string;
  requiredThreshold?: number;
  ttlHours?: number;
}

export interface QuorumProposalResponse {
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

export interface QuorumSignInput {
  proposalId: string;
  signerState: "ML" | "BF" | "NE" | string;
  signature: string;
  signerPublicKey?: string;
}

export interface QuorumSignResponse {
  success: boolean;
  proposal_id: string;
  signer_state: string;
  total_signatures: number;
  required_threshold: number;
  status: string;
  executed: boolean;
  execution_result?: unknown;
}

export interface QuorumProposalsListResponse {
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
    signatures: Array<{ signer_state: string; signed_at: string }>;
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

export interface ReservesClient {
  getPoR(options?: { commodity?: string; batchNumber?: string }): Promise<PoRResponse>;
  listVaults(): Promise<VaultsResponse>;
  getRegimeState(): Promise<RegimeStateResponse>;
  listAssays(options?: { batchNumber?: string; limit?: number }): Promise<AssaysResponse>;
  getDividends(options?: { limit?: number }): Promise<DividendsResponse>;
  proposeQuorum(input: QuorumProposalInput): Promise<QuorumProposalResponse>;
  signQuorum(input: QuorumSignInput): Promise<QuorumSignResponse>;
  listQuorumProposals(options?: { limit?: number }): Promise<QuorumProposalsListResponse>;
}

export type CommodityEscrowStatus = "HELD" | "RELEASED" | "DISPUTED" | "REFUNDED";

export interface CommodityEscrowRecord {
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

export interface CreateEscrowInput {
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

export interface ReleaseEscrowInput {
  escrowId: string;
  assayCertificationNumber: string;
  releaseSignature: string;
}

export interface ReservesEscrowClient {
  createCommodityEscrow(input: CreateEscrowInput): Promise<{ success: boolean; escrow: CommodityEscrowRecord }>;
  releaseEscrowOnAssay(input: ReleaseEscrowInput): Promise<{ success: boolean; escrow: CommodityEscrowRecord }>;
  refundEscrowOnTimeout(escrowId: string): Promise<{ success: boolean; escrow: CommodityEscrowRecord }>;
  getEscrow(escrowId: string): Promise<{ success: boolean; escrow: CommodityEscrowRecord }>;
}

export interface OreIntakeInput {
  receiptNumber: string;
  stationCode: string;
  minerCommitment: string;
  grossWeightGrams: number;
  assayedFineness: number;
  spectrometerSignature: string;
  payoutRatePercent?: number;
}

export interface OreIntakeResponse {
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

export interface ArtisanalStationsResponse {
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

export interface BridgeDoreClientInput {
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

export interface BridgeDoreResponse {
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

export interface ArtisanalClient {
  intakeOre(input: OreIntakeInput): Promise<OreIntakeResponse>;
  listStations(): Promise<ArtisanalStationsResponse>;
  bridgeDoré(input: BridgeDoreClientInput): Promise<BridgeDoreResponse>;
}

export interface DispatchTransitClientInput {
  waybillNumber: string;
  batchNumber: string;
  destinationPortCode: string;
  originVaultId: string;
  carrierCommitment: string;
  carrierBondAngel?: number;
  diplomaticSealDigest: string;
}

export interface DispatchTransitResponse {
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

export interface TransitCheckpointClientInput {
  waybillNumber: string;
  checkpointName: string;
  inspectorSignature: string;
  inspectorPublicKey: string;
}

export interface TransitArrivalClientInput {
  waybillNumber: string;
  portCode: string;
  enclaveSignature: string;
  enclavePublicKey?: string;
}

export interface TransitCorridorsResponse {
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

export interface TransitClient {
  dispatch(input: DispatchTransitClientInput): Promise<DispatchTransitResponse>;
  recordCheckpoint(input: TransitCheckpointClientInput): Promise<{ success: boolean; waybill: { waybill_number: string; status: string; checkpoints_visited: string[] } }>;
  recordArrival(input: TransitArrivalClientInput): Promise<{ success: boolean; waybill: { waybill_number: string; status: string; arrived_at?: string | null } }>;
  listCorridors(): Promise<TransitCorridorsResponse>;
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
  public readonly reserves: ReservesClient;
  public readonly escrow: ReservesEscrowClient;
  public readonly artisanal: ArtisanalClient;
  public readonly transit: TransitClient;

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

    this.reserves = {
      getPoR: async (options?: { commodity?: string; batchNumber?: string }) => {
        const params = new URLSearchParams();
        if (options?.commodity) params.set("commodity", options.commodity);
        if (options?.batchNumber) params.set("batch", options.batchNumber);
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/por${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      listVaults: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/vaults`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      getRegimeState: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/state`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      listAssays: async (options?: { batchNumber?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (options?.batchNumber) params.set("batch", options.batchNumber);
        if (options?.limit) params.set("limit", String(options.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/assays${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      getDividends: async (options?: { limit?: number }) => {
        const params = new URLSearchParams();
        if (options?.limit) params.set("limit", String(options.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/dividends${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      proposeQuorum: async (input: QuorumProposalInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/quorum/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            proposal_id: input.proposalId,
            action_type: input.actionType,
            payload: input.payload,
            proposer_state: input.proposerState,
            required_threshold: input.requiredThreshold,
            ttl_hours: input.ttlHours,
          }),
        });
        return this.parseJsonResponse(response);
      },

      signQuorum: async (input: QuorumSignInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/quorum/sign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            proposal_id: input.proposalId,
            signer_state: input.signerState,
            signature: input.signature,
            signer_public_key: input.signerPublicKey,
          }),
        });
        return this.parseJsonResponse(response);
      },

      listQuorumProposals: async (options?: { limit?: number }) => {
        const params = new URLSearchParams();
        if (options?.limit) params.set("limit", String(options.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/quorum/proposals${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },
    };

    this.escrow = {
      createCommodityEscrow: async (input: CreateEscrowInput) => {
        try {
          const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/escrow`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              action: "create",
              escrow_id: input.escrowId,
              buyer_commitment: input.buyerCommitment,
              seller_commitment: input.sellerCommitment,
              batch_number: input.batchNumber,
              fine_grams: input.fineGrams,
              unit_price_usd: input.unitPriceUsd,
              locked_angel: input.lockedAngel,
              commodity_type: input.commodityType,
              timeout_hours: input.timeoutHours,
            }),
          });
          return await this.parseJsonResponse(response);
        } catch (err) {
          // Idempotent create: on a duplicate escrow_id, re-read the existing record.
          const status = (err as { status?: number }).status;
          if (status === 400) {
            return this.escrow.getEscrow(input.escrowId);
          }
          throw err;
        }
      },

      releaseEscrowOnAssay: async (input: ReleaseEscrowInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/escrow`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            action: "release",
            escrow_id: input.escrowId,
            assay_certification_number: input.assayCertificationNumber,
            release_signature: input.releaseSignature,
          }),
        });
        return this.parseJsonResponse(response);
      },

      refundEscrowOnTimeout: async (escrowId: string) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/escrow`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            action: "refund",
            escrow_id: escrowId,
          }),
        });
        return this.parseJsonResponse(response);
      },

      getEscrow: async (escrowId: string) => {
        const url = `${this.baseUrl}/api/v1/reserves/escrow?escrow_id=${encodeURIComponent(escrowId)}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
        });
        return this.parseJsonResponse(response);
      },
    };

    this.artisanal = {
      intakeOre: async (input: OreIntakeInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/artisanal/intake`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            receipt_number: input.receiptNumber,
            station_code: input.stationCode,
            miner_commitment: input.minerCommitment,
            gross_weight_grams: input.grossWeightGrams,
            assayed_fineness: input.assayedFineness,
            spectrometer_signature: input.spectrometerSignature,
            payout_rate_percent: input.payoutRatePercent,
          }),
        });
        return this.parseJsonResponse(response);
      },

      listStations: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/artisanal/stations`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        return this.parseJsonResponse(response);
      },

      bridgeDoré: async (input: BridgeDoreClientInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/artisanal/bridge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            receipt_numbers: input.receiptNumbers,
            target_batch_number: input.targetBatchNumber,
            vault_id: input.vaultId,
            custodian_name: input.custodianName,
            location_city: input.locationCity,
            location_country: input.locationCountry,
            bar_serials: input.barSerials,
            refined_gross_grams: input.refinedGrossGrams,
            refined_fineness: input.refinedFineness,
          }),
        });
        return this.parseJsonResponse(response);
      },
    };

    this.transit = {
      dispatch: async (input: DispatchTransitClientInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/transit/dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            waybill_number: input.waybillNumber,
            batch_number: input.batchNumber,
            destination_port_code: input.destinationPortCode,
            origin_vault_id: input.originVaultId,
            carrier_commitment: input.carrierCommitment,
            carrier_bond_angel: input.carrierBondAngel,
            diplomatic_seal_digest: input.diplomaticSealDigest,
          }),
        });
        return this.parseJsonResponse(response);
      },

      recordCheckpoint: async (input: TransitCheckpointClientInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/transit/checkpoint`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            waybill_number: input.waybillNumber,
            checkpoint_name: input.checkpointName,
            inspector_signature: input.inspectorSignature,
            inspector_public_key: input.inspectorPublicKey,
          }),
        });
        return this.parseJsonResponse(response);
      },

      recordArrival: async (input: TransitArrivalClientInput) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/transit/arrive`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            waybill_number: input.waybillNumber,
            port_code: input.portCode,
            enclave_signature: input.enclaveSignature,
            enclave_public_key: input.enclavePublicKey,
          }),
        });
        return this.parseJsonResponse(response);
      },

      listCorridors: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/transit/corridors`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
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
