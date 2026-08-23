const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Minimal base58btc encoder (no external dependency) for did:key / Multikey
 * multibase-compatible encodings. Accepts a hex string and returns the base58
 * payload WITHOUT the leading 'z' multicodec marker.
 */
export function base58btcFromHex(hex: string): string {
  const bytes = Buffer.from(hex, "hex");

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Big-number division via repeated mod/div by 58.
  let digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "";
  for (let i = 0; i < zeros; i++) out += BASE58_ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

function enforce64Hex(hex: string): string {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("Expected a 32-byte (64 hex) Ed25519 public key");
  }
  return clean;
}

/**
 * did:key multicodec for Ed25519: 0xed (0x01 0x00 varint pair per recent spec)
 * followed by the 32-byte raw public key, whole thing base58btc-encoded and
 * prefixed 'z'. Matches the `did:key` ed25519-pub method (multicodec 0xed).
 */
export function encodeDidKeyZ(publicKeyHex64: string): string {
  const hex = enforce64Hex(publicKeyHex64);
  return "z" + base58btcFromHex("ed01" + hex);
}

/**
 * W3C Multikey publicKeyMultibase for Ed25519: key type 0x01 (ed25519) then
 * the 32-byte raw key, base58btc-prefixed 'z'. Format:
 * z + base58btc(0x01 || rawkey).
 */
export function encodeMultibaseEd25519(publicKeyHex64: string): string {
  const hex = enforce64Hex(publicKeyHex64);
  return "z" + base58btcFromHex("01" + hex);
}

export function valid64Hex(hex: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hex.replace(/^0x/i, ""));
}