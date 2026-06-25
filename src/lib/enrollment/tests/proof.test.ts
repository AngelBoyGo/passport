import { describe, it, expect } from "vitest";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  verifyChallengeSignature,
  verifyPayloadSignature,
} from "@/lib/enrollment/proof";

const PRIVATE_KEY = hexToBytes("1".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));

async function signMessage(message: string): Promise<string> {
  const sig = await sign(utf8ToBytes(message), PRIVATE_KEY);
  return bytesToHex(sig);
}

describe("verifyChallengeSignature", () => {
  it("accepts a valid nonce signature", async () => {
    const nonce = "challenge-nonce-123";
    const signature = await signMessage(nonce);
    await expect(
      verifyChallengeSignature(PUBLIC_KEY_HEX, nonce, signature)
    ).resolves.toBe(true);
  });

  it("rejects wrong nonce", async () => {
    const signature = await signMessage("correct-nonce");
    await expect(
      verifyChallengeSignature(PUBLIC_KEY_HEX, "wrong-nonce", signature)
    ).resolves.toBe(false);
  });

  it("rejects wrong public key", async () => {
    const otherPk = bytesToHex(getPublicKey(hexToBytes("2".repeat(64))));
    const signature = await signMessage("nonce");
    await expect(
      verifyChallengeSignature(otherPk, "nonce", signature)
    ).resolves.toBe(false);
  });
});

describe("verifyPayloadSignature", () => {
  it("accepts a valid payload digest signature", async () => {
    const digest = "abc123digest";
    const signature = await signMessage(digest);
    await expect(
      verifyPayloadSignature(PUBLIC_KEY_HEX, digest, signature)
    ).resolves.toBe(true);
  });

  it("rejects wrong digest", async () => {
    const signature = await signMessage("digest-a");
    await expect(
      verifyPayloadSignature(PUBLIC_KEY_HEX, "digest-b", signature)
    ).resolves.toBe(false);
  });
});
