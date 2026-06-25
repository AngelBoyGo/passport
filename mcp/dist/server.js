import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PassportClient } from "@passport/sdk";
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
