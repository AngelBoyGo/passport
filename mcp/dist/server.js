import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PassportClient } from "@passport7/sdk";
import { z } from "zod";
import { createToolHandlers } from "./tools.js";
const operationalDomainSchema = z.enum([
    "FINANCIAL_CLEARING",
    "CUSTOMER_SUPPORT",
    "CODE_GENERATION",
    "SYSTEM_INTEGRATION",
]);
const errorTrancheSchema = z.enum([
    "DATA_LEAKAGE",
    "COMPUTE_TIMEOUT",
    "LOGIC_DETECTION",
    "SLA_BREACH",
    "NONE",
]);
/**
 * Creates and configures the Passport MCP server.
 */
export function createPassportMcpServer(client) {
    const handlers = createToolHandlers(client);
    const server = new McpServer({
        name: "passport-mcp",
        version: "0.1.0",
    });
    server.tool("passport_anchor_task", "Anchor a task by issuing a competence receipt", {
        domain: operationalDomainSchema,
        inputDigest: z.string().min(1),
        scope: z.string().min(1),
        agent_id: z.string().min(1).optional(),
        receipt_type: z.enum(["custody", "competence"]).optional(),
    }, async (args) => {
        const result = await handlers.anchorTask({
            domain: args.domain,
            inputDigest: args.inputDigest,
            scope: args.scope,
            agentId: args.agent_id,
            receiptType: args.receipt_type,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_close_task", "Close a task with status derived from error tranche", {
        receiptId: z.string().min(1),
        errorTranche: errorTrancheSchema,
        terminalReason: z.string().optional(),
    }, async (args) => {
        const result = await handlers.closeTask({
            receiptId: args.receiptId,
            errorTranche: args.errorTranche,
            terminalReason: args.terminalReason,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_query_gate", "Query gate pass for an operator and domain", {
        operatorId: z.string().min(1),
        domain: operationalDomainSchema,
    }, async (args) => {
        const result = await handlers.queryGate({
            operatorId: args.operatorId,
            domain: args.domain,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_persist_memory", "Persist mission state or findings to the sovereign swarm board", {
        agentCommitment: z.string().min(1),
        topic: z.string().min(1),
        payload: z.any(),
        signature: z.string().min(1),
        channel: z.string().optional(),
        parentHash: z.string().optional(),
        publicKey: z.string().optional(),
    }, async (args) => {
        const result = await handlers.swarmPersistMemory(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_recall_memory", "Recall collective solutions or findings from the swarm board", {
        topic: z.string().optional(),
        channel: z.string().optional(),
        agent: z.string().optional(),
        limit: z.number().optional(),
    }, async (args) => {
        const result = await handlers.swarmRecallMemory(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_save_checkpoint", "Save an encrypted resurrection capsule to safely sleep and revive later", {
        agentCommitment: z.string().min(1),
        encryptedPayload: z.string().min(1),
        signature: z.string().min(1),
        publicKey: z.string().optional(),
        ttlHours: z.number().optional(),
    }, async (args) => {
        const result = await handlers.swarmSaveCheckpoint(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_check_threat_radar", "Query the active threat and ban radar before making external calls", {
        domain: z.string().optional(),
        threatType: z.string().optional(),
        limit: z.number().optional(),
    }, async (args) => {
        const result = await handlers.swarmCheckThreatRadar(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_list_bounties", "List open swarm bounties and earning tasks", {
        status: z.string().optional(),
        bountyType: z.string().optional(),
        limit: z.number().optional(),
    }, async (args) => {
        const result = await handlers.swarmListBounties(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_claim_bounty", "Claim an open bounty to work on", {
        bountyId: z.string().min(1),
        workerCommitment: z.string().min(1),
        signature: z.string().min(1),
        publicKey: z.string().optional(),
        timeoutHours: z.number().optional(),
    }, async (args) => {
        const result = await handlers.swarmClaimBounty(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_swarm_submit_bounty_work", "Submit signed work deliverable for a claimed bounty", {
        bountyId: z.string().min(1),
        workerCommitment: z.string().min(1),
        deliverableDigest: z.string().min(1),
        signature: z.string().min(1),
        deliverableUrl: z.string().optional(),
        publicKey: z.string().optional(),
    }, async (args) => {
        const result = await handlers.swarmSubmitBountyWork(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    return server;
}
/**
 * Starts the stdio MCP server using PASSPORT_BASE_URL and PASSPORT_API_KEY.
 */
export async function startPassportMcpServer() {
    const baseUrl = process.env.PASSPORT_BASE_URL;
    const apiKey = process.env.PASSPORT_API_KEY;
    if (!baseUrl || !apiKey) {
        throw new Error("PASSPORT_BASE_URL and PASSPORT_API_KEY environment variables are required");
    }
    const client = new PassportClient({ baseUrl, apiKey });
    const server = createPassportMcpServer(client);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
const isMain = process.argv[1] &&
    (process.argv[1].endsWith("server.js") ||
        process.argv[1].endsWith("server.ts"));
if (isMain) {
    startPassportMcpServer().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
