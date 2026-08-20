import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeResponse, stripSensitiveFields } from "@/lib/security/response-sanitizer";

describe("Response Sanitization & XSS Prevention", () => {
  describe("escapeHtml", () => {
    it("escapes HTML special characters", () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
      expect(escapeHtml("safe text")).toBe("safe text");
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("stripSensitiveFields", () => {
    it("removes secret and password fields from API responses", () => {
      const obj = {
        id: "user-1",
        email: "test@example.com",
        passwordHash: "$argon2id...",
        stripeCustomerId: "cus_abc123",
        name: "Test User",
      };
      const cleaned = stripSensitiveFields(obj, ["passwordHash", "stripeCustomerId"]);
      expect(cleaned).not.toHaveProperty("passwordHash");
      expect(cleaned).not.toHaveProperty("stripeCustomerId");
      expect(cleaned).toHaveProperty("id");
      expect(cleaned).toHaveProperty("email");
    });

    it("handles null and undefined gracefully", () => {
      expect(stripSensitiveFields(null, ["secret"])).toBeNull();
      expect(stripSensitiveFields(undefined, ["secret"])).toBeUndefined();
    });
  });

  describe("sanitizeResponse", () => {
    it("strips sensitive fields and escapes string values", () => {
      const response = {
        name: '<b>Agent</b>',
        email: 'user@example.com',
        credential: 'sk_test_abc',
      };
      const sanitized = sanitizeResponse(response, ["credential"]);
      expect(sanitized.name).toBe("&lt;b&gt;Agent&lt;/b&gt;");
      expect(sanitized.email).toBe("user@example.com");
      expect(sanitized).not.toHaveProperty("credential");
    });
  });
});