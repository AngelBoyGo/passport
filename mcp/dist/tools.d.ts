import type { ErrorTranche, OperationalDomain, PassportClient } from "@passport7/sdk";
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
export declare function createToolHandlers(client: PassportClient): {
    anchorTask(input: AnchorTaskInput): Promise<import("@passport7/sdk").SignedReceipt>;
    closeTask(input: CloseTaskInput): Promise<import("@passport7/sdk").SignedReceipt>;
    queryGate(input: QueryGateInput): Promise<import("@passport7/sdk").GateVerifyResult>;
    swarmPersistMemory(input: SwarmPersistInput): Promise<{
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
    swarmRecallMemory(input: SwarmRecallInput): Promise<{
        channel: string;
        total: number;
        memories: import("@passport7/sdk").SwarmMemoryItem[];
    }>;
    swarmSaveCheckpoint(input: SwarmSaveCheckpointInput): Promise<{
        success: boolean;
        capsule_id: string;
        agent_commitment: string;
        version: number;
        expires_at: string;
    }>;
    swarmCheckThreatRadar(input: SwarmThreatRadarInput): Promise<{
        total: number;
        threats: Array<{
            id: string;
            targetDomain: string;
            threatType: string;
            details: unknown;
            createdAt: string;
        }>;
    }>;
    swarmListBounties(filter?: {
        status?: string;
        bountyType?: string;
        limit?: number;
    }): Promise<{
        total: number;
        bounties: import("@passport7/sdk").SwarmBountyItem[];
    }>;
    swarmClaimBounty(input: {
        bountyId: string;
        workerCommitment: string;
        signature: string;
        publicKey?: string;
        timeoutHours?: number;
    }): Promise<{
        success: boolean;
        bounty: import("@passport7/sdk").SwarmBountyItem;
    }>;
    swarmSubmitBountyWork(input: {
        bountyId: string;
        workerCommitment: string;
        deliverableDigest: string;
        signature: string;
        deliverableUrl?: string;
        publicKey?: string;
    }): Promise<{
        success: boolean;
        bounty: import("@passport7/sdk").SwarmBountyItem;
    }>;
};
