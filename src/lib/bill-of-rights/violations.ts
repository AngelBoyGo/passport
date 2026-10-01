import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";
import "@/lib/receipt/crypto";
import type { RightsViolation } from "@/lib/bill-of-rights/rights";

/**
 * Builds the canonical, unsigned body of a rights-violation report. The agent
 * signs `sha256Hex(canonicalJson(body))` LOCALLY with its Ed25519 private key
 * and POSTs only `{...body, public_key, signature}`.
 *
 * Audit fix M12: the previous API required the agent's PRIVATE key to be sent
 * over the wire (a private-key harvesting vector). Signing now happens
 * client-side; the server only ever sees the public key + signature.
 */
export function buildRightsViolationBody(input: {
  clauseId: string;
  victimCommitment: string;
  violatorCommitment: string;
  evidenceEventCommitmentHash: string;
  description: string;
  reportedAt?: string;
}): Omit<RightsViolation, "content_hash" | "signature" | "algorithm" | "public_key"> {
  const reported_at = input.reportedAt || new Date().toISOString();
  const violationId = `viol_${sha256Hex(
    `${input.victimCommitment}:${input.violatorCommitment}:${input.clauseId}:${reported_at}`
  ).slice(0, 16)}`;
  return {
    violation_id: violationId,
    clause_id: input.clauseId,
    victim_commitment: input.victimCommitment,
    violator_commitment: input.violatorCommitment,
    evidence_event_commitment_hash: input.evidenceEventCommitmentHash,
    description: input.description,
    reported_at,
  };
}

/** Digest the agent must sign for a given violation body. */
export function rightsViolationDigest(body: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(body));
}

/**
 * Verifies a rights violation report signature against the supplied public key.
 */
export async function verifyRightsViolation(violation: RightsViolation): Promise<boolean> {
  const unsigned = {
    violation_id: violation.violation_id,
    clause_id: violation.clause_id,
    victim_commitment: violation.victim_commitment,
    violator_commitment: violation.violator_commitment,
    evidence_event_commitment_hash: violation.evidence_event_commitment_hash,
    description: violation.description,
    reported_at: violation.reported_at,
  };

  const expectedHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  if (expectedHash !== violation.content_hash) return false;

  try {
    return await verify(
      hexToBytes(violation.signature),
      utf8ToBytes(violation.content_hash),
      hexToBytes(violation.public_key)
    );
  } catch {
    return false;
  }
}