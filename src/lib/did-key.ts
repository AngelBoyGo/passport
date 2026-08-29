/**
 * M4: proper did:key encoding using multibase base58btc + multicodec ed25519.
 *
 * did:key format: did:key:z${base58btc(multicodec(0xed) + pubkeyBytes)}
 *
 * Where:
 * - 0xed is the multicodec prefix for Ed25519 public key
 * - The combined bytes are base58btc encoded
 * - 'z' prefix indicates base58btc multibase
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// Simple base58 encoder (no dependencies)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  let result = "";
  const digits: number[] = [0];

  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Add leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += "1";
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]];
  }

  return result;
}

/**
 * Helper to consistently encode a 64-hex Ed25519 public key into a proper did:key.
 */
export function encodeDidKey(publicKeyHex: string): string {
  const pubKeyBytes = hexToBytes(publicKeyHex.toLowerCase());
  // Ed25519 multicodec prefix: 0xed (1 byte) + key bytes (32 bytes)
  const multicodecKey = new Uint8Array(1 + pubKeyBytes.length);
  multicodecKey[0] = 0xed;
  multicodecKey.set(pubKeyBytes, 1);
  return `did:key:z${base58Encode(multicodecKey)}`;
}

/**
 * Legacy format detection — returns true if the did starts with our old hex format.
 */
export function isLegacyDidKey(did: string): boolean {
  return /^did:key:z[0-9a-f]{64}$/i.test(did);
}

/**
 * Decodes a did:key Ed25519 public key back to hex.
 */
export function decodeDidKey(did: string): string | null {
  if (!did.startsWith("did:key:z")) return null;
  const encoded = did.slice(9);
  // Legacy format: hex-encoded public key
  if (/^[0-9a-f]{64}$/i.test(encoded)) return encoded.toLowerCase();
  return null;
}