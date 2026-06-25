import type { ErrorTranche, OperationalDomain, PassportClient } from "@passport/sdk";
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
export declare function createToolHandlers(client: PassportClient): {
    anchorTask(input: AnchorTaskInput): Promise<import("@passport/sdk").SignedReceipt>;
    closeTask(input: CloseTaskInput): Promise<import("@passport/sdk").SignedReceipt>;
    queryGate(input: QueryGateInput): Promise<import("@passport/sdk").GateVerifyResult>;
};
