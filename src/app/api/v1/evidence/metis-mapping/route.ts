import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/evidence/metis-mapping
 *
 * Metis Request #3: Confirms exactly how Metis's `metis-job-delivered`
 * payload maps to Passport's TaskDeliverablePayloadSchema, and documents
 * the quality_score persistence path.
 */
export async function GET() {
  return NextResponse.json({
    confirmation: "CONFIRMED — your payload maps to TaskDeliverablePayloadSchema",
    mapping: {
      "your_field": "→ passport_field",
      "payload.job_id": "→ payload.task_id (required, string, min 1 char)",
      "payload.proof_hash": "→ payload.digest (required, 64-hex SHA-256)",
      "payload.at": "→ payload.observed_at (optional, ISO 8601)",
      "payload.bid_id": "→ not persisted (only task_id + digest stored)",
      "payload.bid_usd": "→ not persisted (fiat value lives on Metis)",
      "event_type": "→ NOT sent to Passport. Your event_type 'metis-job-delivered' is implicit in the source_type='task_deliverable'",
      "agent_did": "→ the {commitment} in the URL path (strip did:passport: prefix)",
    },
    correct_request_shape: {
      method: "POST",
      url: "https://passport.metis.gold/api/v1/passport/agents/{commitment}/evidence",
      headers: {
        "Authorization": "Bearer pp_ent_<metis-issuer-key>",
        "Content-Type": "application/json",
      },
      body: {
        source_type: "task_deliverable",
        payload: {
          task_id: "<your job_id>",
          digest: "<your proof_hash>",
          observed_at: "<your at timestamp>",
        },
        signature: "<128-hex Ed25519 signature of sha256(canonicalJson(payload))>",
      },
    },
    quality_score: {
      supported: true,
      how: "Add quality_score to the payload as a passthrough field (Zod .passthrough() allows it)",
      persistence: "Stored in AgentEvidence.sourceDigest alongside the task_id and digest",
      reputation_impact: "NOT YET wired into computeReputationScore() — currently only evidence_count, success_rate, trajectory, corrections, failures are weighted",
      recommendation: "Add quality_score as a 6th factor: quality_score_avg_30d * 100 (max 100 points). Would require tracking avg quality score per agent",
      action_needed: "Passport will add quality_score weighting in the next reputation formula update (Loop 41)",
    },
    example: {
      request: {
        source_type: "task_deliverable",
        payload: {
          task_id: "metis-abc123",
          digest: "a1b2c3d4e5f6...",
          observed_at: "2026-02-13T21:00:00Z",
          quality_score: 8.4,
          bid_usd: 250,
        },
        signature: "<128-hex>",
      },
      response: {
        event_commitment_hash: "64-hex",
        enrollment_status: "ENROLLED",
        server_proof: {
          event_commitment_hash: "64-hex",
          subject_commitment: "64-hex",
          server_received_at: "ISO",
          content_hash: "64-hex",
          signature: "128-hex (server countersign)",
          algorithm: "ed25519",
          public_key: "64-hex",
        },
      },
    },
    notes: [
      "Zod schema uses .passthrough() so extra fields (quality_score, bid_usd) are accepted and stored",
      "The eventCommitmentHash is dedup'd — same task_id + same agent = idempotent skip",
      "Signature is over sha256(canonicalJson(payload)) — canonical JSON = sorted keys, no whitespace",
      "Your Ed25519 signature is verified against the agent's enrolled public key",
      "If you sign with the PLATFORM key (not the agent key), use source_type=task_deliverable and set the URL to the agent's commitment — we verify against the AGENT's key, not yours",
    ],
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}