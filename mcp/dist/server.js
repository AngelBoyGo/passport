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
    server.tool("passport_query_por", "Query live physical commodity Proof-of-Reserves (PoR), Merkle root, and audited lot inclusion proofs", {
        commodity: z.string().optional(),
        batchNumber: z.string().optional(),
    }, async (args) => {
        const result = await handlers.queryPoR(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_get_regime_state", "Query Dual-State Governor regime (SOLID vs GHOST), Bayesian stress metrics, dynamic damping fees, and multi-commodity spot prices", {}, async () => {
        const result = await handlers.getRegimeState();
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_create_commodity_escrow", "Create a bilateral physical-commodity escrow, locking AngelCoin collateral against a vaulted lot", {
        escrow_id: z.string().min(1),
        buyer_commitment: z.string().min(1),
        seller_commitment: z.string().min(1),
        batch_number: z.string().min(1),
        fine_grams: z.number().positive(),
        unit_price_usd: z.number().positive(),
        locked_angel: z.number().positive(),
        commodity_type: z.string().optional(),
        timeout_hours: z.number().optional(),
    }, async (args) => {
        const result = await handlers.createCommodityEscrow({
            escrowId: args.escrow_id,
            buyerCommitment: args.buyer_commitment,
            sellerCommitment: args.seller_commitment,
            batchNumber: args.batch_number,
            fineGrams: args.fine_grams,
            unitPriceUsd: args.unit_price_usd,
            lockedAngel: args.locked_angel,
            commodityType: args.commodity_type,
            timeoutHours: args.timeout_hours,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_release_commodity_escrow", "Release a held commodity escrow to the seller after verified assay certification", {
        escrow_id: z.string().min(1),
        assay_certification_number: z.string().min(1),
        release_signature: z.string().min(1),
    }, async (args) => {
        const result = await handlers.releaseCommodityEscrow({
            escrowId: args.escrow_id,
            assayCertificationNumber: args.assay_certification_number,
            releaseSignature: args.release_signature,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_refund_commodity_escrow", "Refund the buyer's collateral for a commodity escrow that has timed out", {
        escrow_id: z.string().min(1),
    }, async (args) => {
        const result = await handlers.refundCommodityEscrow({ escrowId: args.escrow_id });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_get_sovereign_dividends", "Query macroeconomic Sovereign Dividend Waterfall & Anti-Extraction distributions across national treasury, community trusts, and mine workers", {
        limit: z.number().optional(),
    }, async (args) => {
        const result = await handlers.getSovereignDividends(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_record_ore_intake", "Record verified raw doré gold intake from an artisanal miner at a field buying counter with 95% spot payout", {
        receipt_number: z.string().min(1),
        station_code: z.string().min(1),
        miner_commitment: z.string().min(1),
        gross_weight_grams: z.number().positive(),
        assayed_fineness: z.number().min(0.50).max(1.00),
        spectrometer_signature: z.string().min(1),
        payout_rate_percent: z.number().optional(),
    }, async (args) => {
        const result = await handlers.recordOreIntake({
            receiptNumber: args.receipt_number,
            stationCode: args.station_code,
            minerCommitment: args.miner_commitment,
            grossWeightGrams: args.gross_weight_grams,
            assayedFineness: args.assayed_fineness,
            spectrometerSignature: args.spectrometer_signature,
            payoutRatePercent: args.payout_rate_percent,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_list_artisanal_stations", "List active artisanal gold buying stations, district locations, bonded assayer stakes, and formalization metrics across the Sahel", {}, async () => {
        const result = await handlers.listArtisanalStations();
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_submit_quorum_signature", "Submit an Ed25519 signature from a sovereign state ministry (ML, BF, NE) for a 2-of-3 governance proposal", {
        proposal_id: z.string().min(1),
        signer_state: z.string().min(1),
        signature: z.string().min(1),
        signer_public_key: z.string().optional(),
    }, async (args) => {
        const result = await handlers.submitQuorumSignature({
            proposalId: args.proposal_id,
            signerState: args.signer_state,
            signature: args.signature,
            signerPublicKey: args.signer_public_key,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_list_quorum_proposals", "List active and historical Trilateral Sovereign Governance (AES 2-of-3) proposals, voting progress, and dead-man heartbeats", {
        limit: z.number().optional(),
    }, async (args) => {
        const result = await handlers.listQuorumProposals(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_dispatch_transit_waybill", "Dispatch physical bullion convoy under diplomatic bonded seal to a coastal port enclave (Lomé/Conakry)", {
        waybill_number: z.string().min(1),
        batch_number: z.string().min(1),
        destination_port_code: z.string().min(1),
        origin_vault_id: z.string().min(1),
        carrier_commitment: z.string().min(1),
        diplomatic_seal_digest: z.string().min(1),
        carrier_bond_angel: z.number().optional(),
    }, async (args) => {
        const result = await handlers.dispatchTransitWaybill({
            waybillNumber: args.waybill_number,
            batchNumber: args.batch_number,
            destinationPortCode: args.destination_port_code,
            originVaultId: args.origin_vault_id,
            carrierCommitment: args.carrier_commitment,
            diplomaticSealDigest: args.diplomatic_seal_digest,
            carrierBondAngel: args.carrier_bond_angel,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_record_port_arrival", "Confirm arrival of diplomatic bonded bullion convoy at coastal port customs enclave and release carrier bond", {
        waybill_number: z.string().min(1),
        port_code: z.string().min(1),
        enclave_signature: z.string().min(1),
        enclave_public_key: z.string().optional(),
    }, async (args) => {
        const result = await handlers.recordPortArrival({
            waybillNumber: args.waybill_number,
            portCode: args.port_code,
            enclaveSignature: args.enclave_signature,
            enclavePublicKey: args.enclave_public_key,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.tool("passport_list_transit_corridors", "List coastal port customs enclaves (Lomé & Conakry), active diplomatic transit waybills, and logistics metrics", {}, async () => {
        const result = await handlers.listTransitCorridors();
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
