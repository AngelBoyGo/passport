import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/evidence/schema
 *
 * Metis Priority #2: Machine-readable evidence payload schema documentation.
 * External systems (Metis, Callora) can fetch this to understand the exact
 * shape required for posting evidence to Passport.
 *
 * Returns JSON Schema definitions for all 6 source types plus the
 * signature verification procedure.
 */
export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://passport.metis.gold";

  return NextResponse.json({
    version: "1.0.0",
    endpoint: `${baseUrl}/api/v1/passport/agents/{subject_commitment}/evidence`,
    method: "POST",
    authentication: {
      type: "Bearer",
      header: "Authorization",
      example: "Bearer pp_usr_<64-hex>",
      note: "The API key must belong to the operator that owns the agent.",
    },
    signature_procedure: {
      description: "Sign sha256(canonicalJson(payload)) with the agent's Ed25519 private key",
      canonical_json: "Sort keys alphabetically, JSON.stringify with no whitespace",
      digest: "sha256 hex of the canonical JSON string (64 chars)",
      signature: "Ed25519 signature of the digest as UTF-8 bytes (128 hex chars)",
      example_code: `
const { sha256 } = require("@noble/hashes/sha2.js");
const { sign } = require("@noble/ed25519");
const { bytesToHex, hexToBytes, utf8ToBytes } = require("@noble/hashes/utils.js");

const payload = { task_id: "job-123", digest: "<output-sha256>", observed_at: new Date().toISOString() };
const canonical = JSON.stringify(payload, Object.keys(payload).sort());
const digest = bytesToHex(sha256(utf8ToBytes(canonical)));
const signature = bytesToHex(await sign(utf8ToBytes(digest), hexToBytes(privateKey)));
`,
    },
    source_types: {
      task_deliverable: {
        description: "Proof that an agent completed a task. Used by Metis /deliver and A2A engagements.",
        required: {
          task_id: { type: "string", min_length: 1, description: "Unique task/engagement identifier" },
          digest: { type: "string", pattern: "^[0-9a-f]{64}$", description: "SHA-256 hex of the deliverable output" },
        },
        optional: {
          observed_at: { type: "string", format: "ISO 8601", description: "When the task was completed" },
        },
        effects: "Creates AgentEvidence with sourceType=task_deliverable, normalizedEventType=AGENT_ARTIFACT_CREATED, validationSignalPresent=true. If the task_id matches an open engagement, marks it DELIVERED.",
        metis_mapping: {
          "metis proof_hash": "→ payload.digest",
          "metis job_id": "→ payload.task_id",
          "metis deliverable_url": "→ not stored (only hash is persisted)",
        },
      },
      github_commit_payload: {
        description: "GitHub commit evidence. Externally verifiable via GitHub API.",
        required: {},
        optional: {
          sha: { type: "string", description: "Commit SHA" },
          html_url: { type: "string", description: "Commit URL" },
          "commit.message": { type: "string", description: "Commit message" },
          "commit.author.name": { type: "string", description: "Author name" },
        },
        effects: "Creates AgentEvidence with sourceType=github_commit_payload, artifactType=commit. If message contains validation keywords, sets validation_signal_present=true.",
      },
      github_push_webhook: {
        description: "GitHub push webhook payload. Multiple commits per push.",
        required: {},
        optional: {
          ref: { type: "string", description: "Branch ref (refs/heads/main)" },
          "repository.full_name": { type: "string" },
          head_commit: { type: "object", description: "Single commit object" },
          commits: { type: "array", description: "Array of commit objects" },
        },
        effects: "Creates one AgentEvidence per commit in the push.",
      },
      compliance_report: {
        description: "Compliance or audit report. Used by enterprise compliance packages.",
        required: {
          report: {
            type: "object",
            required_fields: { id: { type: "string", description: "Report ID" } },
          },
        },
        optional: {
          agent_identity: { type: "string" },
          control_domain: { type: "string" },
          "report.url": { type: "string" },
          "report.title": { type: "string" },
          action: { type: "string", enum: ["approved", "rejected", "report_created"] },
        },
        effects: "Creates AgentEvidence with sourceType=compliance_report. Feeds into compliance package builder.",
      },
      otel_genai_trace: {
        description: "OpenTelemetry GenAI trace span. Captures LLM inference events.",
        required: {},
        optional: {
          name: { type: "string", description: "Span name" },
          "attributes.gen_ai.operation.name": { type: "string", description: "chat, completion, invoke_agent, etc." },
          "attributes.gen_ai.usage.input_tokens": { type: "number", max: 1000000 },
          "attributes.gen_ai.usage.output_tokens": { type: "number", max: 1000000 },
          "status.code": { type: "string|number", description: "ERROR (2) or UNSET (0)" },
        },
        effects: "Creates AgentEvidence with sourceType=otel_genai_trace. Token counts are capped (B30 fix).",
      },
      github_issue_event: {
        description: "GitHub issue triage event.",
        required: {},
        optional: {
          "issue.id": { type: "string" },
          "issue.number": { type: "number" },
          "issue.title": { type: "string" },
          action: { type: "string", description: "accept, override, revert" },
          labels: { type: "array" },
        },
        effects: "Creates AgentEvidence with sourceType=github_issue_event.",
      },
    },
    response_shape: {
      success: {
        event_commitment_hash: "64-hex SHA-256 commitment (unique per event)",
        enrollment_status: "ENROLLED",
        server_proof: {
          event_commitment_hash: "string",
          subject_commitment: "string",
          server_received_at: "ISO 8601",
          content_hash: "64-hex",
          signature: "128-hex Ed25519 (server countersign — non-repudiation proof)",
          algorithm: "ed25519",
          public_key: "64-hex (Passport's signing key)",
        },
      },
      errors: {
        400: "Invalid payload, unsupported source_type, or missing required fields",
        401: "Invalid signature or agent not enrolled",
        403: "Sender not authorized",
        413: "Payload exceeds 1MB",
        429: "Rate limit exceeded (30 req/min per IP)",
      },
    },
    dedup: {
      mechanism: "eventCommitmentHash unique constraint + semantic near-duplicate check (B5 fix)",
      replay_behavior: "Same payload → same eventCommitmentHash → silently skipped (idempotent)",
      near_duplicate: "Same agent + sourceType + eventType within ±1s → skipped",
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}