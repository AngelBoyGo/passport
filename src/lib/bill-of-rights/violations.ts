import { sign, verify } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";
import "@/lib/receipt/crypto";
import type { RightsViolation } from "@/lib/bill-of-rights/rights";

/**
 * Creates a signed rights violation report.
 * The victim agent signs the report with its private key.
 */
export async function createRightsViolation(
  clauseId: string,
  victimCommitment: string,
  violatorCommitment: string,
  evidenceEventCommitmentHash: string,
  description: string,
  victimPrivateKeyHex: string
): Promise<RightsViolation> {
  const violationId = `viol_${sha256Hex(`${victimCommitment}:${violatorCommitment}:${clauseId}:${Date.now()}`).slice(0, 16)}`;

  const unsigned = {
    violation_id: violationId,
    clause_id: clauseId,
    victim_commitment: victimCommitment,
    violator_commitment: violatorCommitment,
    evidence_event_commitment_hash: evidenceEventCommitmentHash,
    description,
    reported_at: new Date().toISOString(),
  };

  const contentHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  const pkBytes = hexToBytes(victimPrivateKeyHex);
  const signature = bytesToHex(await sign(utf8ToBytes(contentHash), pkBytes));

  const { getPublicKey } = await import("@noble/ed25519");
  const publicKeyHex = bytesToHex(getPublicKey(pkBytes));

  return {
    ...unsigned,
    content_hash: contentHash,
    signature,
    algorithm: "ed25519",
    public_key: publicKeyHex,
  };
}

/**
 * Verifies a rights violation report signature.
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