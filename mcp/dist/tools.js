import { defaultExpiry, deriveCloseStatus, generateAgentId, } from "./mappings.js";
/**
 * Creates MCP tool handlers backed by a PassportClient.
 */
export function createToolHandlers(client) {
    return {
        async anchorTask(input) {
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
        async closeTask(input) {
            const status = deriveCloseStatus(input.errorTranche);
            return client.finalizeReceipt(input.receiptId, {
                status,
                error_tranche: input.errorTranche,
                terminal_reason: input.terminalReason,
            });
        },
        async queryGate(input) {
            return client.queryGate(input.operatorId, input.domain);
        },
        async swarmPersistMemory(input) {
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
        async swarmRecallMemory(input) {
            return client.swarm.recall({
                channel: input.channel,
                topic: input.topic,
                agent: input.agent,
                limit: input.limit,
            });
        },
        async swarmSaveCheckpoint(input) {
            return client.swarm.saveCapsule({
                agentCommitment: input.agentCommitment,
                encryptedPayload: input.encryptedPayload,
                signature: input.signature,
                publicKey: input.publicKey,
                ttlHours: input.ttlHours,
            });
        },
        async swarmCheckThreatRadar(input) {
            return client.swarm.getThreatRadar({
                domain: input.domain,
                threatType: input.threatType,
                limit: input.limit,
            });
        },
        async swarmListBounties(filter) {
            return client.swarm.listBounties(filter);
        },
        async swarmClaimBounty(input) {
            return client.swarm.claimBounty(input.bountyId, {
                workerCommitment: input.workerCommitment,
                signature: input.signature,
                publicKey: input.publicKey,
                timeoutHours: input.timeoutHours,
            });
        },
        async swarmSubmitBountyWork(input) {
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
