/**
 * Evidence Signing Utility — ensures client-side signatures match server-side verification.
 *
 * The server computes: sha256Hex(canonicalJson(payload)) then verifies
 * the Ed25519 signature over utf8ToBytes(digestHexString).
 *
 * This module exports the exact same functions the server uses,
 * eliminating any client/server canonicalization mismatch.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sign, getPublicKey } from "@noble/ed25519";

function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

function randomBytesHex(n: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
}

/**
 * Canonical JSON — sorts keys alphabetically, produces compact JSON.
 * This MUST match the server's canonicalJson exactly.
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
 * Computes the payload digest the same way the server does.
 * Returns a hex string (NOT raw bytes).
 */
export function computePayloadDigest(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    return bytesToHex(sha256(utf8ToBytes(String(payload))));
  }
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(payload as Record<string, unknown>))));
}

/**
 * Signs the payload digest for evidence submission.
 * The signature is over utf8ToBytes(digestHexString) — NOT raw hex-decoded bytes.
 *
 * @param payload - The evidence payload object
 * @param privateKeyHex - The agent's Ed25519 private key as 32-byte hex
 * @returns { digest, signature } ready for the evidence API
 */
export function signEvidencePayload(
  payload: Record<string, unknown>,
  privateKeyHex: string
): { digest: string; signature: string } {
  const digest = computePayloadDigest(payload);
  const digestBytes = utf8ToBytes(digest); // UTF-8 encoding of the hex string
  const signature = sign(digestBytes, hexToBytes(privateKeyHex));
  return {
    digest,
    signature: bytesToHex(signature),
  };
}

/**
 * Signs an A2A hire message.
 * The message format matches the hire-service contract.
 */
export function signHireRequest(
  proposalId: string,
  hirerCommitment: string,
  workerCommitment: string,
  terms: Record<string, unknown>,
  privateKeyHex: string
): { digest: string; signature: string } {
  const canonicalTerms = canonicalJson(terms);
  const message = `${proposalId}:${hirerCommitment}:${workerCommitment}:${canonicalTerms}`;
  const digestBytes = utf8ToBytes(sha256Hex(message));
  const signature = sign(digestBytes, hexToBytes(privateKeyHex));
  return {
    digest: bytesToHex(sha256(utf8ToBytes(message))),
    signature: bytesToHex(signature),
  };
}

/**
 * Generates a new Ed25519 keypair for agent enrollment.
 * Returns hex-encoded keys compatible with Passport's API.
 */
export function generateAgentKeypair(): {
  publicKeyHex: string;
  privateKeyHex: string;
} {
  const privKey = crypto.getRandomValues(new Uint8Array(32));
  const pubKeyBytes = getPublicKey(privKey);
  return {
    publicKeyHex: bytesToHex(pubKeyBytes),
    privateKeyHex: bytesToHex(privKey),
  };
}