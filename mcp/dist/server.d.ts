import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PassportClient } from "@passport/sdk";
/**
 * Creates and configures the Passport MCP server.
 */
export declare function createPassportMcpServer(client: PassportClient): McpServer;
/**
 * Starts the stdio MCP server using PASSPORT_BASE_URL and PASSPORT_API_KEY.
 */
export declare function startPassportMcpServer(): Promise<void>;
