import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/openapi.json — OpenAPI 3.1.0 Specification for Passport API.
 */
export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Passport Trust Substrate API",
      version: "1.0.0",
      description:
        "Portable, tamper-evident signed behavioral receipts, identity commitments, and agent protocol endpoints for autonomous AI agents.",
      contact: {
        name: "Passport Operator",
        url: baseUrl,
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      {
        url: baseUrl,
        description: "Production Server",
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "pp_<64-hex>",
          description: "Operator API Key. Obtain from /admin/api-keys or Stripe subscription checkout.",
        },
        SessionAuth: {
          type: "apiKey",
          in: "cookie",
          name: "session_token",
          description: "Operator web session cookie.",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
          },
        },
        GateVerifyRequest: {
          type: "object",
          required: ["operator_id", "domain"],
          properties: {
            operator_id: { type: "string", description: "Public operator ID (op_cus_...)" },
            domain: {
              type: "string",
              enum: ["FINANCIAL_CLEARING", "CUSTOMER_SUPPORT", "CODE_GENERATION", "SYSTEM_INTEGRATION"],
            },
          },
        },
        GateVerifyResponse: {
          type: "object",
          required: ["allow_invocation"],
          properties: {
            allow_invocation: { type: "boolean" },
            reason: { type: "string" },
          },
        },
        ReceiptIssueRequest: {
          type: "object",
          required: ["agent_id", "receipt_type", "input_digest", "authority_scope", "expiry"],
          properties: {
            agent_id: { type: "string" },
            receipt_type: { type: "string", enum: ["custody", "competence"] },
            input_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
            authority_scope: { type: "string" },
            expiry: { type: "string", format: "date-time" },
            domain: { type: "string" },
            prev_receipt_hash: { type: "string" },
            blind: { type: "boolean" },
          },
        },
        EvidenceIngestRequest: {
          type: "object",
          required: ["source_type", "payload", "signature"],
          properties: {
            source_type: {
              type: "string",
              enum: [
                "github_push_webhook",
                "github_commit_payload",
                "github_issue_event",
                "compliance_report",
                "otel_genai_trace",
                "task_deliverable",
              ],
            },
            payload: {
              type: "object",
              description: "Parsed JSON object matching the source_type schema. Never send as raw string.",
            },
            signature: {
              type: "string",
              pattern: "^[0-9a-f]{128}$",
              description: "Ed25519 signature over sha256(canonicalJson(payload))",
            },
          },
        },
      },
    },
    paths: {
      "/api/health": {
        get: {
          summary: "Database Liveness Probe",
          responses: {
            "200": { description: "Service healthy" },
            "503": { description: "Service degraded" },
          },
        },
      },
      "/api/v1/public-key": {
        get: {
          summary: "Published Ed25519 Verifying Key",
          responses: {
            "200": {
              description: "Published public key with kid rotation metadata",
            },
          },
        },
      },
      "/api/v1/gate/verify": {
        post: {
          summary: "Evaluate Gate Pass for Operational Domain",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/GateVerifyRequest" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/GateVerifyResponse" } } } },
          },
        },
      },
      "/api/v1/receipts": {
        get: {
          summary: "Search Receipts",
          security: [{ ApiKeyAuth: [] }],
          responses: { "200": { description: "List of operator receipts" } },
        },
        post: {
          summary: "Issue a Pending Signed Receipt",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ReceiptIssueRequest" } } },
          },
          responses: { "201": { description: "Receipt issued and signed" } },
        },
      },
      "/api/v1/receipts/{id}/public-manifest": {
        get: {
          summary: "Get Public Receipt Manifest for Offline Verification",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Receipt manifest with Ed25519 signature and inclusion path" } },
        },
      },
      "/api/v1/passport/agents/{id}/evidence": {
        post: {
          summary: "Ingest Signed Agent Evidence",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/EvidenceIngestRequest" } } },
          },
          responses: { "201": { description: "Evidence anchored with event_commitment_hash" } },
        },
      },
      "/.well-known/agent.json": {
        get: {
          summary: "Google A2A Agent Card Discovery",
          responses: { "200": { description: "A2A Agent Card" } },
        },
      },
      "/api/v1/a2a/tasks": {
        post: {
          summary: "A2A JSON-RPC 2.0 Task Delegation",
          responses: { "200": { description: "JSON-RPC 2.0 Task Response" } },
        },
      },
      "/api/v1/acp/task": {
        post: {
          summary: "ACP Task Create with Escrow Lock",
          security: [{ ApiKeyAuth: [] }],
          responses: { "201": { description: "ACP Task created" } },
        },
      },
      "/.well-known/did.json": {
        get: {
          summary: "W3C DID Document for Passport Controller",
          responses: { "200": { description: "DID Document" } },
        },
      },
      "/api/v1/anp/agents/{commitment}": {
        get: {
          summary: "W3C Agent DID Document with did:key",
          parameters: [{ name: "commitment", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Agent DID Document" } },
        },
      },
      "/api/v1/agora/negotiate": {
        post: {
          summary: "AGORA Protocol Agreement Proposal",
          responses: { "201": { description: "Proposal recorded on capability ledger" } },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
