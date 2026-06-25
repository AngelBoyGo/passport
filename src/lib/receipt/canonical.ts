import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ReceiptPayload } from "./types";

/**
 * SHA-256 hex digest of arbitrary string input.
 */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/**
 * SHA-256 commitment binding a plaintext domain to a per-receipt salt.
 */
export function computeDomainCommitment(
  domain: string,
  blindSalt: string
): string {
  return sha256Hex(domain + blindSalt);
}

type CanonicalFields = Omit<ReceiptPayload, "signature" | "content_hash">;

/**
 * Builds the canonical payload used for hashing and signing (excludes signature).
 */
export function buildCanonicalPayload(
  receipt: Partial<ReceiptPayload> & CanonicalFields
): CanonicalFields {
  const payload: CanonicalFields = {
    receipt_id: receipt.receipt_id,
    issued_at: receipt.issued_at,
    operator_id: receipt.operator_id,
    agent_id: receipt.agent_id,
    receipt_type: receipt.receipt_type,
    status: receipt.status,
    input_digest: receipt.input_digest,
    authority_scope: receipt.authority_scope,
    expiry: receipt.expiry,
    revocation_status: receipt.revocation_status,
  };

  if (receipt.output_hash !== undefined) payload.output_hash = receipt.output_hash;
  if (receipt.refusal_reason !== undefined)
    payload.refusal_reason = receipt.refusal_reason;
  if (receipt.terminal_reason !== undefined)
    payload.terminal_reason = receipt.terminal_reason;
  if (receipt.prev_receipt_hash !== undefined)
    payload.prev_receipt_hash = receipt.prev_receipt_hash;
  const domainSlot = receipt.domain_commitment ?? receipt.domain;
  if (domainSlot !== undefined) payload.domain = domainSlot;
  if (receipt.error_tranche !== undefined)
    payload.error_tranche = receipt.error_tranche;

  return payload;
}

/**
 * Deterministic JSON serialization with sorted keys for tamper-evident hashing.
 */
export function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of sorted) {
    ordered[key] = obj[key];
  }
  return JSON.stringify(ordered);
}

/**
 * Computes content_hash from canonical receipt fields (excluding signature).
 */
export function computeContentHash(
  receipt: Partial<ReceiptPayload> & CanonicalFields
): string {
  const canonical = buildCanonicalPayload(receipt);
  return sha256Hex(canonicalJson(canonical as unknown as Record<string, unknown>));
}

/**
 * Returns the message bytes signed by ed25519 (content_hash as UTF-8).
 */
export function signingMessage(contentHash: string): Uint8Array {
  return utf8ToBytes(contentHash);
}
