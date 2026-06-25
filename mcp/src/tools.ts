import type { ErrorTranche, OperationalDomain, PassportClient } from "@passport/sdk";
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
  };
}
