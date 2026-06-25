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
    };
}
