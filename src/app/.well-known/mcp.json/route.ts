import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/mcp.json — Model Context Protocol (MCP) tool manifest.
 *
 * Exposes standardized tools for Claude Code, Cursor, Windsurf, LangChain,
 * and autonomous agents to integrate with Passport trust substrate.
 */
export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  const manifest = {
    schema_version: "2024-11-05",
    name: "passport",
    display_name: "Passport Trust Substrate",
    description: "Tamper-evident behavioral receipt verification, gate checks, and evidence anchoring for AI agents.",
    homepage: baseUrl,
    documentation: `${baseUrl}/docs/api-reference`,
    tools: [
      {
        name: "passport_gate_verify",
        description: "Evaluate domain SLA compliance and minimum escrow bond before invoking an external AI agent.",
        parameters: {
          type: "object",
          required: ["operator_id", "domain"],
          properties: {
            operator_id: {
              type: "string",
              description: "Public operator ID (op_cus_...)",
            },
            domain: {
              type: "string",
              enum: [
                "FINANCIAL_CLEARING",
                "CUSTOMER_SUPPORT",
                "CODE_GENERATION",
                "SYSTEM_INTEGRATION",
              ],
              description: "Operational domain to verify against.",
            },
          },
        },
        endpoint: `${baseUrl}/api/v1/gate/verify`,
        method: "POST",
      },
      {
        name: "passport_post_evidence",
        description: "Anchor signed behavioral evidence for an enrolled agent on the privacy-preserving Passport ledger.",
        parameters: {
          type: "object",
          required: ["subject_commitment", "source_type", "payload", "signature"],
          properties: {
            subject_commitment: {
              type: "string",
              description: "64-character hex identity commitment of the enrolled agent.",
            },
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
              description: "JSON object matching the selected source_type schema.",
            },
            signature: {
              type: "string",
              description: "128-hex Ed25519 signature over sha256(canonicalJson(payload)).",
            },
          },
        },
        endpoint: `${baseUrl}/api/v1/passport/agents/{subject_commitment}/evidence`,
        method: "POST",
      },
      {
        name: "passport_verify_receipt",
        description: "Fetch a public receipt manifest and verify its Ed25519 signature and hash inclusion path.",
        parameters: {
          type: "object",
          required: ["receipt_id"],
          properties: {
            receipt_id: {
              type: "string",
              description: "Receipt ID (rcpt_...)",
            },
          },
        },
        endpoint: `${baseUrl}/api/v1/receipts/{receipt_id}/public-manifest`,
        method: "GET",
      },
      {
        name: "passport_get_profile",
        description: "Retrieve an agent's behavioral archetype, evidence count, and performance trajectory.",
        parameters: {
          type: "object",
          required: ["commitment_hash"],
          properties: {
            commitment_hash: {
              type: "string",
              description: "64-character hex agent identity commitment.",
            },
          },
        },
        endpoint: `${baseUrl}/api/v1/profiles/{commitment_hash}`,
        method: "GET",
      },
      {
        name: "passport_get_verifiable_credential",
        description: "Fetch a signed W3C Verifiable Credential representing an agent's portable reputation.",
        parameters: {
          type: "object",
          required: ["commitment_hash"],
          properties: {
            commitment_hash: {
              type: "string",
              description: "64-character hex agent identity commitment.",
            },
          },
        },
        endpoint: `${baseUrl}/api/v1/credentials/{commitment_hash}`,
        method: "GET",
      },
      {
        name: "passport_verify_credential",
        description: "Verify any external W3C AgentReputationCredential offline against the issuer's Ed25519 signature.",
        parameters: {
          type: "object",
          required: ["credential"],
          properties: {
            credential: {
              type: "object",
              description: "Full JSON-LD Verifiable Credential object.",
            },
          },
        },
        endpoint: `${baseUrl}/api/v1/credentials/verify`,
        method: "POST",
      },
      {
        name: "passport_get_compliance_package",
        description: "Generate an audit-grade compliance evidence package mapped to NIST AI RMF, EU AI Act, or SOC2.",
        parameters: {
          type: "object",
          required: ["commitment_hash"],
          properties: {
            commitment_hash: { type: "string", description: "64-character hex agent identity commitment." },
            framework: { type: "string", enum: ["NIST_AI_RMF", "EU_AI_ACT", "SOC2_TYPE2", "ISO_42001"] },
          },
        },
        endpoint: `${baseUrl}/api/v1/compliance/packages/{commitment_hash}`,
        method: "GET",
      },
      {
        name: "passport_get_merkle_checkpoint",
        description: "Retrieve the latest signed Merkle checkpoint root over finalized receipts.",
        parameters: {
          type: "object",
          properties: {},
        },
        endpoint: `${baseUrl}/api/v1/receipts/checkpoints/latest`,
        method: "GET",
      },
      {
        name: "passport_ingest_datacenter_telemetry",
        description: "Ingest live hardware-measured power, thermal safety, and carbon avoidance telemetry for GPU data centers and AI clusters.",
        parameters: {
          type: "object",
          required: ["cluster_id", "instance_id", "event_type", "origin", "sku"],
          properties: {
            cluster_id: { type: "string" },
            instance_id: { type: "string" },
            event_type: {
              type: "string",
              enum: [
                "HARDWARE_POWER_VALIDATION",
                "POLICY_SETPOINT_TRANSITION",
                "THERMAL_SAFETY_AUDIT",
                "CARBON_AVOIDED_ACCRUAL",
                "WORKLOAD_ENERGY_EFFICIENCY",
              ],
            },
            origin: { type: "string", enum: ["live-instrument", "synthetic"] },
            sku: { type: "string" },
            baseline_nameplate_w: { type: "number" },
            measured_power_avg_w: { type: "number" },
            delta_power_pct: { type: "number" },
            policy_setpoint_applied: { type: "string" },
          },
        },
        endpoint: `${baseUrl}/api/v1/datacenter/evidence`,
        method: "POST",
      },
      {
        name: "passport_get_datacenter_scorecard",
        description: "Retrieve verified data center cluster scorecard including hardware vs modeled breakdown, energy saved, and thermal pass rate.",
        parameters: {
          type: "object",
          required: ["cluster_id"],
          properties: {
            cluster_id: { type: "string" },
          },
        },
        endpoint: `${baseUrl}/api/v1/datacenter/clusters/{cluster_id}/scorecard`,
        method: "GET",
      },
      {
        name: "passport_autonomous_provision",
        description: "Self-provision an autonomous Passport identity and Holder API key (pp_usr_...) via Proof-of-Work and Ed25519 proof of possession without human verification.",
        parameters: {
          type: "object",
          required: ["public_key", "challenge_nonce", "pow_nonce", "signature"],
          properties: {
            public_key: { type: "string", description: "64-hex Ed25519 public key" },
            challenge_nonce: { type: "string", description: "Challenge nonce from /challenge" },
            pow_nonce: { type: "string", description: "Solved Proof-of-Work nonce" },
            signature: { type: "string", description: "128-hex signature over sha256(challenge_nonce:pow_nonce:public_key)" },
            display_name: { type: "string", description: "Optional agent display name" },
            domain: { type: "string", description: "Operational domain" },
          },
        },
        endpoint: `${baseUrl}/api/v1/passport/agents/autonomous/provision`,
        method: "POST",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
