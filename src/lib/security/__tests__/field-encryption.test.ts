import { describe, it, expect } from "vitest";
import { encryptField, decryptField, generateEncryptionKey } from "@/lib/security/field-encryption";

describe("Field-Level Encryption (AES-256-GCM)", () => {
  const key = generateEncryptionKey();

  it("encrypts and decrypts a field value deterministically", () => {
    const plaintext = "whsec_test_secret_value_12345";
    const encrypted = encryptField(plaintext, key);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);

    const decrypted = decryptField(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for repeated encryption calls (IV salt)", () => {
    const plaintext = "repeated-value";
    const enc1 = encryptField(plaintext, key);
    const enc2 = encryptField(plaintext, key);
    expect(enc1).not.toBe(enc2);
    // Both should decrypt correctly
    expect(decryptField(enc1, key)).toBe(plaintext);
    expect(decryptField(enc2, key)).toBe(plaintext);
  });

  it("returns null when decrypting with a mismatched key", () => {
    const plaintext = "secret-webhook-token";
    const encrypted = encryptField(plaintext, key);
    const wrongKey = generateEncryptionKey();
    const result = decryptField(encrypted, wrongKey);
    // AES-GCM auth tag fails — returns null
    expect(result).toBeNull();
  });
});
