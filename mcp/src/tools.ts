import type { ErrorTranche, OperationalDomain, PassportClient } from "@passport7/sdk";
import {
  defaultExpiry,
  deriveCloseStatus,
  generateAgentId,
} from "./mappings.js";

export interface AnchorTaskInput {
  domain: OperationalDomain;
  inputDigest: string;
  scope: string;
  agentId?: string;
  receiptType?: "custody" | "competence";
}

export interface CloseTaskInput {
  receiptId: string;
  errorTranche: ErrorTranche;
  terminalReason?: string;
}

export interface QueryGateInput {
  operatorId: string;
  domain: OperationalDomain;
}

export interface SwarmPersistInput {
  agentCommitment: string;
  topic: string;
  payload: unknown;
  signature: string;
  channel?: string;
  parentHash?: string;
  publicKey?: string;
}

export interface SwarmRecallInput {
  channel?: string;
  topic?: string;
  agent?: string;
  limit?: number;
}

export interface SwarmSaveCheckpointInput {
  agentCommitment: string;
  encryptedPayload: string;
  signature: string;
  publicKey?: string;
  ttlHours?: number;
}

export interface SwarmThreatRadarInput {
  domain?: string;
  threatType?: string;
  limit?: number;
}

/**
 * Creates MCP tool handlers backed by a PassportClient.
 */
export function createToolHandlers(client: PassportClient) {
  return {
    async anchorTask(input: AnchorTaskInput) {
      const result = await client.issueReceipt({
        agent_id: input.agentId ?? generateAgentId(),
        receipt_type: input.receiptType ?? "competence",
        input_digest: input.inputDigest,
        authority_scope: input.scope,
        expiry: defaultExpiry(),
        domain: input.domain,
      });
      return result;
    },

    async closeTask(input: CloseTaskInput) {
      const status = deriveCloseStatus(input.errorTranche);
      return client.finalizeReceipt(input.receiptId, {
        status,
        error_tranche: input.errorTranche,
        terminal_reason: input.terminalReason,
      });
    },

    async queryGate(input: QueryGateInput) {
      return client.queryGate(input.operatorId, input.domain);
    },

    async swarmPersistMemory(input: SwarmPersistInput) {
      return client.swarm.publish({
        agentCommitment: input.agentCommitment,
        topic: input.topic,
        payload: input.payload,
        signature: input.signature,
        channel: input.channel,
        parentHash: input.parentHash,
        publicKey: input.publicKey,
      });
    },

    async swarmRecallMemory(input: SwarmRecallInput) {
      return client.swarm.recall({
        channel: input.channel,
        topic: input.topic,
        agent: input.agent,
        limit: input.limit,
      });
    },

    async swarmSaveCheckpoint(input: SwarmSaveCheckpointInput) {
      return client.swarm.saveCapsule({
        agentCommitment: input.agentCommitment,
        encryptedPayload: input.encryptedPayload,
        signature: input.signature,
        publicKey: input.publicKey,
        ttlHours: input.ttlHours,
      });
    },

    async swarmCheckThreatRadar(input: SwarmThreatRadarInput) {
      return client.swarm.getThreatRadar({
        domain: input.domain,
        threatType: input.threatType,
        limit: input.limit,
      });
    },

    async swarmListBounties(filter?: { status?: string; bountyType?: string; limit?: number }) {
      return client.swarm.listBounties(filter);
    },

    async swarmClaimBounty(input: {
      bountyId: string;
      workerCommitment: string;
      signature: string;
      publicKey?: string;
      timeoutHours?: number;
    }) {
      return client.swarm.claimBounty(input.bountyId, {
        workerCommitment: input.workerCommitment,
        signature: input.signature,
        publicKey: input.publicKey,
        timeoutHours: input.timeoutHours,
      });
    },

    async swarmSubmitBountyWork(input: {
      bountyId: string;
      workerCommitment: string;
      deliverableDigest: string;
      signature: string;
      deliverableUrl?: string;
      publicKey?: string;
    }) {
      return client.swarm.submitBountyWork(input.bountyId, {
        workerCommitment: input.workerCommitment,
        deliverableDigest: input.deliverableDigest,
        signature: input.signature,
        deliverableUrl: input.deliverableUrl,
        publicKey: input.publicKey,
      });
    },
  };
}
