import { describe, it, expect } from "vitest";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  computePresentationDigest,
  isAllowedPhotoMimeType,
  isValidHttpsPhotoUrl,
  validatePresentationFields,
} from "@/lib/enrollment/presentation";
import { verifyPayloadSignature } from "@/lib/enrollment/proof";

const PRIVATE_KEY = hexToBytes("3".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));
const SUBJECT_COMMITMENT = "a".repeat(64);

async function signDigest(digest: string): Promise<string> {
  const sig = await sign(utf8ToBytes(digest), PRIVATE_KEY);
  return bytesToHex(sig);
}

describe("computePresentationDigest", () => {
  it("hashes canonical JSON with sorted keys", () => {
    const digest = computePresentationDigest({
      subjectCommitment: SUBJECT_COMMITMENT,
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "b".repeat(64),
      photoMimeType: "image/png",
    });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(
      computePresentationDigest({
        subjectCommitment: SUBJECT_COMMITMENT,
        photoUrl: "https://cdn.example.com/agent.png",
        photoContentSha256: "b".repeat(64),
        photoMimeType: "image/png",
      })
    );
  });

  it("differs when photo_url changes", () => {
    const base = {
      subjectCommitment: SUBJECT_COMMITMENT,
      photoContentSha256: "b".repeat(64),
      photoMimeType: "image/png",
    };
    const a = computePresentationDigest({
      ...base,
      photoUrl: "https://cdn.example.com/a.png",
    });
    const b = computePresentationDigest({
      ...base,
      photoUrl: "https://cdn.example.com/b.png",
    });
    expect(a).not.toBe(b);
  });

  it("supports clear digest with empty strings", () => {
    const digest = computePresentationDigest({
      subjectCommitment: SUBJECT_COMMITMENT,
      photoUrl: "",
      photoContentSha256: "",
      photoMimeType: "",
    });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidHttpsPhotoUrl", () => {
  it("accepts https URLs", () => {
    expect(isValidHttpsPhotoUrl("https://cdn.example.com/photo.png")).toBe(true);
  });

  it("rejects http URLs", () => {
    expect(isValidHttpsPhotoUrl("http://cdn.example.com/photo.png")).toBe(false);
  });

  it("rejects data URLs", () => {
    expect(isValidHttpsPhotoUrl("data:image/png;base64,abc")).toBe(false);
  });

  it("rejects javascript URLs", () => {
    expect(isValidHttpsPhotoUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects ipfs URLs", () => {
    expect(isValidHttpsPhotoUrl("ipfs://QmExample")).toBe(false);
  });

  it("accepts empty string for clear", () => {
    expect(isValidHttpsPhotoUrl("")).toBe(true);
  });
});

describe("isAllowedPhotoMimeType", () => {
  it("allows image/png, jpeg, webp, gif", () => {
    expect(isAllowedPhotoMimeType("image/png")).toBe(true);
    expect(isAllowedPhotoMimeType("image/jpeg")).toBe(true);
    expect(isAllowedPhotoMimeType("image/webp")).toBe(true);
    expect(isAllowedPhotoMimeType("image/gif")).toBe(true);
  });

  it("rejects other mime types", () => {
    expect(isAllowedPhotoMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedPhotoMimeType("application/pdf")).toBe(false);
  });

  it("accepts empty string for clear", () => {
    expect(isAllowedPhotoMimeType("")).toBe(true);
  });
});

describe("validatePresentationFields", () => {
  it("requires content sha256 when url is set", () => {
    expect(() =>
      validatePresentationFields({
        photoUrl: "https://cdn.example.com/a.png",
        photoContentSha256: "",
        photoMimeType: "image/png",
      })
    ).toThrow(/photo_content_sha256/);
  });

  it("requires mime type when url is set", () => {
    expect(() =>
      validatePresentationFields({
        photoUrl: "https://cdn.example.com/a.png",
        photoContentSha256: "b".repeat(64),
        photoMimeType: "",
      })
    ).toThrow(/photo_mime_type/);
  });

  it("accepts signed clear with all empty", () => {
    expect(() =>
      validatePresentationFields({
        photoUrl: "",
        photoContentSha256: "",
        photoMimeType: "",
      })
    ).not.toThrow();
  });
});

describe("presentation signature verify", () => {
  it("accepts valid presentation digest signature", async () => {
    const digest = computePresentationDigest({
      subjectCommitment: SUBJECT_COMMITMENT,
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "b".repeat(64),
      photoMimeType: "image/png",
    });
    const signature = await signDigest(digest);
    await expect(
      verifyPayloadSignature(PUBLIC_KEY_HEX, digest, signature)
    ).resolves.toBe(true);
  });

  it("rejects invalid signature", async () => {
    const digest = computePresentationDigest({
      subjectCommitment: SUBJECT_COMMITMENT,
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "b".repeat(64),
      photoMimeType: "image/png",
    });
    await expect(
      verifyPayloadSignature(PUBLIC_KEY_HEX, digest, "c".repeat(128))
    ).resolves.toBe(false);
  });
});
