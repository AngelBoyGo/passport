import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    webhookSubscription: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  dispatchWebhook,
  computeWebhookSignature,
  deliverWebhookWithRetry,
} from "@/lib/webhooks/webhook-service";

describe("Webhook Queue & Retry Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("computeWebhookSignature", () => {
    it("computes deterministic HMAC SHA-256 signature over webhook body and secret", () => {
      const payload = { event: "evidence.anchored", data: { id: "123" } };
      const secret = "whsec_test_secret_12345";
      const sig1 = computeWebhookSignature(payload, secret);
      const sig2 = computeWebhookSignature(payload, secret);

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("deliverWebhookWithRetry", () => {
    it("successfully delivers on first attempt when target returns 200", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const result = await deliverWebhookWithRetry({
        url: "https://subscriber.test/webhook",
        secret: "whsec_123",
        event: "evidence.anchored",
        payload: { commit: "abc" },
        maxAttempts: 3,
      });

      expect(result.delivered).toBe(true);
      expect(result.attempts).toBe(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://subscriber.test/webhook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Passport-Event": "evidence.anchored",
            "X-Passport-Signature": expect.any(String),
          }),
        })
      );
    });

    it("retries on 500 error up to maxAttempts and records dead letter failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Internal error", { status: 500 })
      );

      const result = await deliverWebhookWithRetry({
        url: "https://subscriber.test/webhook",
        secret: "whsec_123",
        event: "evidence.anchored",
        payload: { commit: "abc" },
        maxAttempts: 3,
        retryDelayMs: 5, // fast delay for unit test
      });

      expect(result.delivered).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.deadLetter).toBe(true);
    });
  });
});
