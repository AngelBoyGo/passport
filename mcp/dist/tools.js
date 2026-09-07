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
        async queryPoR(input) {
            return client.reserves.getPoR(input);
        },
        async getRegimeState() {
            return client.reserves.getRegimeState();
        },
        async createCommodityEscrow(input) {
            return client.escrow.createCommodityEscrow({
                escrowId: input.escrowId,
                buyerCommitment: input.buyerCommitment,
                sellerCommitment: input.sellerCommitment,
                batchNumber: input.batchNumber,
                fineGrams: input.fineGrams,
                unitPriceUsd: input.unitPriceUsd,
                lockedAngel: input.lockedAngel,
                commodityType: input.commodityType,
                timeoutHours: input.timeoutHours,
            });
        },
        async releaseCommodityEscrow(input) {
            return client.escrow.releaseEscrowOnAssay({
                escrowId: input.escrowId,
                assayCertificationNumber: input.assayCertificationNumber,
                releaseSignature: input.releaseSignature,
            });
        },
        async refundCommodityEscrow(input) {
            return client.escrow.refundEscrowOnTimeout(input.escrowId);
        },
        async getSovereignDividends(options) {
            return client.reserves.getDividends(options);
        },
        async recordOreIntake(input) {
            return client.artisanal.intakeOre(input);
        },
        async listArtisanalStations() {
            return client.artisanal.listStations();
        },
        async submitQuorumSignature(input) {
            return client.reserves.signQuorum(input);
        },
        async listQuorumProposals(options) {
            return client.reserves.listQuorumProposals(options);
        },
        async dispatchTransitWaybill(input) {
            return client.transit.dispatch(input);
        },
        async recordPortArrival(input) {
            return client.transit.recordArrival(input);
        },
        async listTransitCorridors() {
            return client.transit.listCorridors();
        },
        async recordSmeltingTelemetry(input) {
            return client.industrial.recordSmelting(input);
        },
        async listIndustrialConcessions() {
            return client.industrial.listConcessions();
        },
    };
}
