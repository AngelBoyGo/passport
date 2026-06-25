import { sha256Hex } from "@/lib/receipt/canonical";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Default enrollment context when the agent omits an explicit context. */
export const DEFAULT_ENROLLMENT_CONTEXT = "passport-v1";

/**
 * Derives a stable 64-hex agent identity commitment from a canonical ed25519 public key.
 */
export function deriveAgentCommitment(
  publicKeyHex: string,
  context: string = DEFAULT_ENROLLMENT_CONTEXT
): string {
  return sha256Hex(`agent-id:${publicKeyHex.toLowerCase()}:${context}`);
}

/**
 * Validates a 32-byte ed25519 public key encoded as 64 hex characters.
 */
export function isValidPublicKeyHex(publicKeyHex: string): boolean {
  return /^[0-9a-f]{64}$/i.test(publicKeyHex);
}

/**
 * Generates a random 32-byte challenge nonce as lowercase hex.
 */
export function generateChallengeNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
