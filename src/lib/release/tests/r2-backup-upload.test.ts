import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encryptBackupPayload,
  uploadBackupToR2,
  buildR2EndpointUrl,
} from "@/lib/release/backup-db";

describe("Cloudflare R2 Off-Site Encrypted Backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("encryptBackupPayload", () => {
    it("encrypts SQL dump payload with AES-256-GCM and returns iv, authTag, and ciphertext", () => {
      const sql = "CREATE TABLE Receipt (id text primary key);";
      const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      const encrypted = encryptBackupPayload(sql, keyHex);
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("authTag");
      expect(encrypted).toHaveProperty("ciphertext");
      expect(encrypted.ciphertext).not.toContain("CREATE TABLE");
    });
  });

  describe("buildR2EndpointUrl", () => {
    it("builds correct S3-compatible Cloudflare R2 URL", () => {
      const url = buildR2EndpointUrl("my-account-id", "passport-backups", "2026-08-20/dump.sql.enc");
      expect(url).toBe("https://my-account-id.r2.cloudflarestorage.com/passport-backups/2026-08-20/dump.sql.enc");
    });
  });

  describe("uploadBackupToR2", () => {
    it("successfully uploads encrypted payload to Cloudflare R2 via PUT", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      const result = await uploadBackupToR2({
        sqlDump: "SELECT 1;",
        accountId: "acc_123",
        bucket: "passport-backups",
        keyName: "backup-2026-08-20.sql.enc",
        encryptionKeyHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://acc_123.r2.cloudflarestorage.com/passport-backups/backup-2026-08-20.sql.enc",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "Content-Type": "application/octet-stream",
          }),
        })
      );
    });
  });
});
