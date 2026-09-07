"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ERROR_TRANCHES: () => ERROR_TRANCHES,
  OPERATIONAL_DOMAINS: () => OPERATIONAL_DOMAINS,
  PassportCallbackHandler: () => PassportCallbackHandler,
  PassportClient: () => PassportClient,
  PassportHttpError: () => PassportHttpError,
  classifyExecutionError: () => classifyExecutionError,
  classifyMastraError: () => classifyMastraError,
  createMastraPassportMiddleware: () => createMastraPassportMiddleware,
  fetchWithRetry: () => fetchWithRetry,
  isErrorTranche: () => isErrorTranche,
  isOperationalDomain: () => isOperationalDomain,
  passportMiddleware: () => passportMiddleware,
  withPassportAudit: () => withPassportAudit
});
module.exports = __toCommonJS(index_exports);

// src/http.ts
var PassportHttpError = class extends Error {
  status;
  responseBody;
  constructor(message, status, responseBody) {
    super(message);
    this.name = "PassportHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
};
var DEFAULT_BACKOFF_MS = [200, 400, 800];
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return void 0;
  }
}
async function fetchWithRetry(url, init, options = {}) {
  const timeoutMs = options.timeoutMs ?? 4e3;
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await globalThis.fetch(url, {
        ...init,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.status >= 400 && response.status < 500) {
        return response;
      }
      if (response.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await sleep(DEFAULT_BACKOFF_MS[attempt] ?? 800);
          continue;
        }
        throw new PassportHttpError(
          `HTTP ${response.status}`,
          response.status,
          await safeJson(response)
        );
      }
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof PassportHttpError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await sleep(DEFAULT_BACKOFF_MS[attempt] ?? 800);
        continue;
      }
    }
  }
  throw new PassportHttpError(
    lastError?.message ?? "Request failed after retries",
    void 0,
    void 0
  );
}

// src/client.ts
function canonicalJson(obj) {
  const sorted = Object.keys(obj).sort();
  const ordered = {};
  for (const key of sorted) ordered[key] = obj[key];
  return JSON.stringify(ordered);
}
async function sha256Hex(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var PassportClient = class {
  apiKey;
  baseUrl;
  swarm;
  reserves;
  escrow;
  artisanal;
  transit;
  industrial;
  fund;
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.swarm = {
      publish: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/memory`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            agent_commitment: input.agentCommitment,
            channel: input.channel,
            topic: input.topic,
            payload: input.payload,
            signature: input.signature,
            parent_hash: input.parentHash,
            public_key: input.publicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      recall: async (query) => {
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
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      saveCapsule: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/capsule`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            agent_commitment: input.agentCommitment,
            encrypted_payload: input.encryptedPayload,
            signature: input.signature,
            public_key: input.publicKey,
            ttl_hours: input.ttlHours
          })
        });
        return this.parseJsonResponse(response);
      },
      restoreCapsule: async (agentCommitment) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/capsule/${agentCommitment}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${this.apiKey}`
            }
          }
        );
        return this.parseJsonResponse(response);
      },
      reportThreat: async (input) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/radar/report`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              reporter_commitment: input.reporterCommitment,
              target_domain: input.targetDomain,
              threat_type: input.threatType,
              details: input.details,
              evidence_digest: input.evidenceDigest,
              signature: input.signature,
              public_key: input.publicKey
            })
          }
        );
        return this.parseJsonResponse(response);
      },
      getThreatRadar: async (options2) => {
        const params = new URLSearchParams();
        if (options2?.domain) params.set("domain", options2.domain);
        if (options2?.threatType) params.set("threat_type", options2.threatType);
        if (options2?.limit) params.set("limit", String(options2.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/swarm/radar/active-threats${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      createBounty: async (params) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/swarm/bounties`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            creator_commitment: params.creatorCommitment,
            title: params.title,
            description: params.description,
            reward_angel: params.rewardAngel,
            signature: params.signature,
            bounty_type: params.bountyType,
            public_key: params.publicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      listBounties: async (filter) => {
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
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      claimBounty: async (bountyId, params) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/claim`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              worker_commitment: params.workerCommitment,
              signature: params.signature,
              public_key: params.publicKey,
              timeout_hours: params.timeoutHours
            })
          }
        );
        return this.parseJsonResponse(response);
      },
      submitBountyWork: async (bountyId, params) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/submit`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              worker_commitment: params.workerCommitment,
              deliverable_digest: params.deliverableDigest,
              deliverable_url: params.deliverableUrl,
              signature: params.signature,
              public_key: params.publicKey
            })
          }
        );
        return this.parseJsonResponse(response);
      },
      completeBounty: async (bountyId, params) => {
        const response = await fetchWithRetry(
          `${this.baseUrl}/api/v1/swarm/bounties/${bountyId}/complete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
              verifier_commitment: params.verifierCommitment,
              signature: params.signature,
              public_key: params.publicKey
            })
          }
        );
        return this.parseJsonResponse(response);
      }
    };
    this.reserves = {
      getPoR: async (options2) => {
        const params = new URLSearchParams();
        if (options2?.commodity) params.set("commodity", options2.commodity);
        if (options2?.batchNumber) params.set("batch", options2.batchNumber);
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/por${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      listVaults: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/vaults`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      getRegimeState: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/state`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      listAssays: async (options2) => {
        const params = new URLSearchParams();
        if (options2?.batchNumber) params.set("batch", options2.batchNumber);
        if (options2?.limit) params.set("limit", String(options2.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/assays${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      getDividends: async (options2) => {
        const params = new URLSearchParams();
        if (options2?.limit) params.set("limit", String(options2.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/dividends${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      proposeQuorum: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/quorum/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            proposal_id: input.proposalId,
            action_type: input.actionType,
            payload: input.payload,
            proposer_state: input.proposerState,
            required_threshold: input.requiredThreshold,
            ttl_hours: input.ttlHours
          })
        });
        return this.parseJsonResponse(response);
      },
      signQuorum: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/quorum/sign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            proposal_id: input.proposalId,
            signer_state: input.signerState,
            signature: input.signature,
            signer_public_key: input.signerPublicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      listQuorumProposals: async (options2) => {
        const params = new URLSearchParams();
        if (options2?.limit) params.set("limit", String(options2.limit));
        const qs = params.toString();
        const url = `${this.baseUrl}/api/v1/reserves/quorum/proposals${qs ? `?${qs}` : ""}`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      }
    };
    this.escrow = {
      createCommodityEscrow: async (input) => {
        try {
          const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/escrow`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
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
              timeout_hours: input.timeoutHours
            })
          });
          return await this.parseJsonResponse(response);
        } catch (err) {
          const status = err.status;
          if (status === 400) {
            return this.escrow.getEscrow(input.escrowId);
          }
          throw err;
        }
      },
      releaseEscrowOnAssay: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/escrow`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            action: "release",
            escrow_id: input.escrowId,
            assay_certification_number: input.assayCertificationNumber,
            release_signature: input.releaseSignature
          })
        });
        return this.parseJsonResponse(response);
      },
      refundEscrowOnTimeout: async (escrowId) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/escrow`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            action: "refund",
            escrow_id: escrowId
          })
        });
        return this.parseJsonResponse(response);
      },
      getEscrow: async (escrowId) => {
        const url = `${this.baseUrl}/api/v1/reserves/escrow?escrow_id=${encodeURIComponent(escrowId)}`;
        const response = await fetchWithRetry(url, {
          method: "GET"
        });
        return this.parseJsonResponse(response);
      }
    };
    this.artisanal = {
      intakeOre: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/artisanal/intake`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            receipt_number: input.receiptNumber,
            station_code: input.stationCode,
            miner_commitment: input.minerCommitment,
            gross_weight_grams: input.grossWeightGrams,
            assayed_fineness: input.assayedFineness,
            spectrometer_signature: input.spectrometerSignature,
            payout_rate_percent: input.payoutRatePercent
          })
        });
        return this.parseJsonResponse(response);
      },
      listStations: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/artisanal/stations`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      bridgeDor\u00E9: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/artisanal/bridge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
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
            refined_fineness: input.refinedFineness
          })
        });
        return this.parseJsonResponse(response);
      }
    };
    this.transit = {
      dispatch: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/transit/dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            waybill_number: input.waybillNumber,
            batch_number: input.batchNumber,
            destination_port_code: input.destinationPortCode,
            origin_vault_id: input.originVaultId,
            carrier_commitment: input.carrierCommitment,
            carrier_bond_angel: input.carrierBondAngel,
            diplomatic_seal_digest: input.diplomaticSealDigest
          })
        });
        return this.parseJsonResponse(response);
      },
      recordCheckpoint: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/transit/checkpoint`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            waybill_number: input.waybillNumber,
            checkpoint_name: input.checkpointName,
            inspector_signature: input.inspectorSignature,
            inspector_public_key: input.inspectorPublicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      recordArrival: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/transit/arrive`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            waybill_number: input.waybillNumber,
            port_code: input.portCode,
            enclave_signature: input.enclaveSignature,
            enclave_public_key: input.enclavePublicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      listCorridors: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/transit/corridors`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      }
    };
    this.industrial = {
      recordSmelting: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/industrial/smelt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            run_number: input.runNumber,
            concession_code: input.concessionCode,
            gross_poured_grams: input.grossPouredGrams,
            density_grams_per_cc: input.densityGramsPerCc,
            estimated_au_fineness: input.estimatedAuFineness,
            estimated_ag_fineness: input.estimatedAgFineness,
            hsm_signature: input.hsmSignature,
            hsm_public_key: input.hsmPublicKey
          })
        });
        return this.parseJsonResponse(response);
      },
      bridgeDor\u00E9: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/industrial/bridge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            run_numbers: input.runNumbers,
            target_batch_number: input.targetBatchNumber,
            vault_id: input.vaultId,
            custodian_name: input.custodianName,
            location_city: input.locationCity,
            location_country: input.locationCountry,
            bar_serials: input.barSerials,
            refined_gross_grams: input.refinedGrossGrams,
            refined_fineness: input.refinedFineness
          })
        });
        return this.parseJsonResponse(response);
      },
      listConcessions: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/industrial/concessions`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      }
    };
    this.fund = {
      registerProject: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/fund/projects`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            project_code: input.projectCode,
            project_name: input.projectName,
            category: input.category,
            country_code: input.countryCode,
            district_name: input.districtName,
            operator_commitment: input.operatorCommitment,
            allocated_angel: input.allocatedAngel,
            total_milestones: input.totalMilestones,
            expected_jobs: input.expectedJobs,
            declared_impact_kwh: input.declaredImpactKwh
          })
        });
        return this.parseJsonResponse(response);
      },
      listProjects: async () => {
        const url = `${this.baseUrl}/api/v1/reserves/fund/projects`;
        const response = await fetchWithRetry(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });
        return this.parseJsonResponse(response);
      },
      verifyMilestone: async (input) => {
        const response = await fetchWithRetry(`${this.baseUrl}/api/v1/reserves/fund/milestones`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            disbursement_id: input.disbursementId,
            verifier_signature: input.verifierSignature,
            verifier_public_key: input.verifierPublicKey,
            media_digest: input.mediaDigest,
            verification_description: input.verificationDescription,
            jobs_created: input.jobsCreated,
            realized_impact_kwh: input.realizedImpactKwh
          })
        });
        return this.parseJsonResponse(response);
      }
    };
  }
  /**
   * Issue a pending signed receipt (Bearer auth required).
   */
  async issueReceipt(input) {
    const response = await fetchWithRetry(`${this.baseUrl}/api/v1/receipts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(input)
    });
    return this.parseJsonResponse(response);
  }
  /**
   * Finalize a receipt with outcome (Bearer auth required).
   */
  async finalizeReceipt(receiptId, input) {
    const response = await fetchWithRetry(
      `${this.baseUrl}/api/v1/receipts/${receiptId}/finalize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(input)
      }
    );
    return this.parseJsonResponse(response);
  }
  /**
   * Query gate pass for an operator/domain (no auth).
   */
  async queryGate(publicOperatorId, domain) {
    const response = await fetchWithRetry(`${this.baseUrl}/api/v1/gate/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        operator_id: publicOperatorId,
        domain
      })
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
  async signEvidence(payload, signDigest) {
    const canonical = canonicalJson(payload);
    const digest = await sha256Hex(canonical);
    const signature = await signDigest(digest);
    return { payload, canonical, digest, signature };
  }
  /**
   * Post signed evidence for an enrolled agent.
   * Requires the agent to be enrolled and the payload to be signed
   * via `signEvidence()`.
   */
  async postEvidence(subjectCommitment, sourceType, payload, signature, options) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (options?.serviceToken) {
      headers.Authorization = `Bearer ${options.serviceToken}`;
    }
    const response = await fetchWithRetry(
      `${this.baseUrl}/api/v1/passport/agents/${subjectCommitment}/evidence`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_type: sourceType, payload, signature })
      }
    );
    return this.parseJsonResponse(response);
  }
  async parseJsonResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new PassportHttpError(message, response.status, body);
    }
    return body;
  }
};

// src/enums.ts
var OPERATIONAL_DOMAINS = [
  "FINANCIAL_CLEARING",
  "CUSTOMER_SUPPORT",
  "CODE_GENERATION",
  "SYSTEM_INTEGRATION"
];
var ERROR_TRANCHES = [
  "DATA_LEAKAGE",
  "COMPUTE_TIMEOUT",
  "LOGIC_DETECTION",
  "SLA_BREACH",
  "NONE"
];
function isOperationalDomain(value) {
  return typeof value === "string" && OPERATIONAL_DOMAINS.includes(value);
}
function isErrorTranche(value) {
  return typeof value === "string" && ERROR_TRANCHES.includes(value);
}

// src/middleware/mastra.ts
var import_node_crypto = require("crypto");
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function sha256Hex2(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
}
function defaultInputDigest(input) {
  return sha256Hex2(JSON.stringify(input ?? null));
}
function defaultExpiry(now = Date.now()) {
  return new Date(now + THIRTY_DAYS_MS).toISOString();
}
function hashOutput(output) {
  return sha256Hex2(JSON.stringify(output ?? null));
}
function classifyMastraError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("rate limit") || lower.includes("context length") || lower.includes("max tokens")) {
    return "COMPUTE_TIMEOUT";
  }
  if (lower.includes("file validation") || lower.includes("schema mutation") || lower.includes("validation failed")) {
    return "LOGIC_DETECTION";
  }
  return "SLA_BREACH";
}
async function runWithReceipt(client, options, input, agentLabel, fn) {
  const receipt = await client.issueReceipt({
    agent_id: options.agentId ?? agentLabel ?? "mastra-agent",
    receipt_type: "competence",
    input_digest: (options.getInputDigest ?? defaultInputDigest)(input),
    authority_scope: options.scope ?? "mastra.middleware",
    expiry: defaultExpiry(),
    domain: options.domain
  });
  try {
    const output = await fn();
    await client.finalizeReceipt(receipt.receipt_id, {
      status: "success",
      output_hash: hashOutput(output)
    });
    return output;
  } catch (err) {
    const terminalReason = err instanceof Error ? err.message : "Unhandled Mastra failure";
    await client.finalizeReceipt(receipt.receipt_id, {
      status: "failure_tombstone",
      error_tranche: classifyMastraError(terminalReason),
      terminal_reason: terminalReason
    });
    throw err;
  }
}
function createMastraPassportMiddleware(client, options) {
  return {
    wrapAgent(agent) {
      const original = agent.generate.bind(agent);
      return {
        ...agent,
        generate: (input) => runWithReceipt(
          client,
          options,
          input,
          agent.name,
          () => original(input)
        )
      };
    },
    wrapWorkflow(workflow) {
      const method = workflow.execute ?? workflow.run;
      if (!method) {
        throw new Error("MastraWorkflowLike requires run or execute");
      }
      const original = method.bind(workflow);
      const wrappedMethod = (input) => runWithReceipt(
        client,
        options,
        input,
        workflow.name,
        () => original(input)
      );
      if (workflow.execute) {
        return { ...workflow, execute: wrappedMethod };
      }
      return { ...workflow, run: wrappedMethod };
    }
  };
}

// src/middleware/audit.ts
var import_node_crypto2 = require("crypto");
function sha256Hex3(value) {
  return (0, import_node_crypto2.createHash)("sha256").update(value).digest("hex");
}
function classifyExecutionError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("rate limit") || lower.includes("token limit") || lower.includes("429")) {
    return "COMPUTE_TIMEOUT";
  }
  if (lower.includes("schema") || lower.includes("validation") || lower.includes("parse") || lower.includes("type error")) {
    return "LOGIC_DETECTION";
  }
  return "SLA_BREACH";
}
function withPassportAudit(fn, options) {
  return async (...args) => {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();
    const inputDigest = sha256Hex3(JSON.stringify(args));
    let output;
    let executionError;
    try {
      output = await fn(...args);
    } catch (err) {
      executionError = err instanceof Error ? err : new Error(String(err));
      const endMs2 = Date.now();
      const finishedAt2 = new Date(endMs2).toISOString();
      if (options.signDigest) {
        try {
          const payload = {
            task_id: `fail-${startMs}`,
            digest: inputDigest,
            error_classification: classifyExecutionError(executionError.message),
            observed_at: finishedAt2
          };
          const { signature } = await options.client.signEvidence(payload, options.signDigest);
          const result = await options.client.postEvidence(
            options.subjectCommitment,
            options.sourceType ?? "task_deliverable",
            payload,
            signature,
            { serviceToken: options.serviceToken }
          );
          options.onAuditComplete?.({
            eventCommitmentHash: result.event_commitment_hash,
            latencyMs: endMs2 - startMs,
            error: executionError
          });
        } catch {
        }
      }
      throw executionError;
    }
    const endMs = Date.now();
    const finishedAt = new Date(endMs).toISOString();
    const outputDigest = sha256Hex3(JSON.stringify(output ?? null));
    if (options.signDigest) {
      try {
        const payload = {
          task_id: `task-${startMs}`,
          digest: outputDigest,
          observed_at: finishedAt
        };
        const { signature } = await options.client.signEvidence(payload, options.signDigest);
        const result = await options.client.postEvidence(
          options.subjectCommitment,
          options.sourceType ?? "task_deliverable",
          payload,
          signature,
          { serviceToken: options.serviceToken }
        );
        options.onAuditComplete?.({
          eventCommitmentHash: result.event_commitment_hash,
          latencyMs: endMs - startMs
        });
      } catch {
      }
    }
    return output;
  };
}

// src/vercel-ai.ts
function passportMiddleware(config) {
  const baseUrl = config.baseUrl || "https://passport.metis.gold";
  const sourceType = config.sourceType || "otel_genai_trace";
  return {
    onGenerate: async ({ operation }) => {
      const startTime = Date.now();
      const inputDigest = await sha256Hex4(operation.input[0]?.text || "");
      return {
        onFinish: async (result) => {
          const outputText = result.text || "";
          const outputDigest = await sha256Hex4(outputText);
          const payload = {
            task_id: `gen_${inputDigest.slice(0, 16)}`,
            digest: outputDigest,
            input_digest: inputDigest,
            model: operation.model || "unknown",
            duration_ms: Date.now() - startTime,
            token_usage_input: result.usage?.promptTokens || 0,
            token_usage_output: result.usage?.completionTokens || 0,
            finish_reason: result.finishReason || "unknown",
            observed_at: (/* @__PURE__ */ new Date()).toISOString()
          };
          try {
            await fetch(`${baseUrl}/api/v1/passport/agents/${config.commitment}/evidence`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`
              },
              body: JSON.stringify({
                source_type: sourceType,
                payload,
                signature: "0".repeat(128)
              })
            });
          } catch {
          }
        }
      };
    }
  };
}
async function sha256Hex4(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/langchain.ts
var PassportCallbackHandler = class {
  config;
  baseUrl;
  startTimes = /* @__PURE__ */ new Map();
  constructor(config) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://passport.metis.gold";
  }
  name = "PassportCallbackHandler";
  async handleLLMStart(llm, prompts, runId) {
    this.startTimes.set(runId, Date.now());
  }
  async handleLLMEnd(output, runId) {
    const startTime = this.startTimes.get(runId);
    if (!startTime) return;
    this.startTimes.delete(runId);
    const outputText = output.generations?.[0]?.[0]?.text || "";
    const inputText = "";
    const durationMs = Date.now() - startTime;
    const tokenUsage = output.llmOutput?.tokenUsage || {};
    const payload = {
      task_id: `langchain_${runId.slice(0, 12)}`,
      digest: await sha256Hex5(outputText),
      model: "langchain",
      duration_ms: durationMs,
      token_usage_input: tokenUsage.promptTokens || 0,
      token_usage_output: tokenUsage.completionTokens || 0,
      finish_reason: "stop",
      observed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await fetch(`${this.baseUrl}/api/v1/passport/agents/${this.config.commitment}/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          source_type: "otel_genai_trace",
          payload,
          signature: "0".repeat(128)
        })
      });
    } catch {
    }
  }
  async handleLLMError(_err, runId) {
    this.startTimes.delete(runId);
  }
};
async function sha256Hex5(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ERROR_TRANCHES,
  OPERATIONAL_DOMAINS,
  PassportCallbackHandler,
  PassportClient,
  PassportHttpError,
  classifyExecutionError,
  classifyMastraError,
  createMastraPassportMiddleware,
  fetchWithRetry,
  isErrorTranche,
  isOperationalDomain,
  passportMiddleware,
  withPassportAudit
});
