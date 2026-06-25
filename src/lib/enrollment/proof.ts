import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { isValidPublicKeyHex } from "@/lib/enrollment/identity";

/**
 * Verifies an ed25519 signature over a challenge nonce using the agent public key.
 */
export async function verifyChallengeSignature(
  publicKeyHex: string,
  nonce: string,
  signatureHex: string
): Promise<boolean> {
  if (!isValidPublicKeyHex(publicKeyHex)) {
    return false;
  }
  if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length !== 128) {
    return false;
  }

  try {
    return verify(
      hexToBytes(signatureHex),
      utf8ToBytes(nonce),
      hexToBytes(publicKeyHex)
    );
  } catch {
    return false;
  }
}

/**
 * Verifies an ed25519 signature over a payload digest using the agent public key.
 */
export async function verifyPayloadSignature(
  publicKeyHex: string,
  payloadDigest: string,
  signatureHex: string
): Promise<boolean> {
  return verifyChallengeSignature(publicKeyHex, payloadDigest, signatureHex);
}
