import { prisma } from "@/lib/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export type WebhookEvent = "evidence.anchored" | "enrollment.completed";

export interface WebhookDeliveryOptions {
  url: string;
  secret: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  attempts: number;
  deadLetter?: boolean;
  error?: string;
}

/**
 * Computes deterministic HMAC-like SHA-256 signature for webhook verification.
 * Format: sha256(canonicalJson(payload) + secret)
 */
export function computeWebhookSignature(
  payload: unknown,
  secret: string
): string {
  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  return bytesToHex(sha256(utf8ToBytes(jsonStr + secret)));
}

/**
 * Delivers a webhook with automatic retry up to maxAttempts using exponential backoff.
 */
export async function deliverWebhookWithRetry(
  options: WebhookDeliveryOptions
): Promise<WebhookDeliveryResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.retryDelayMs ?? 1000;
  const body = {
    event: options.event,
    data: options.payload,
    timestamp: new Date().toISOString(),
  };
  const bodyStr = JSON.stringify(body);
  const signature = computeWebhookSignature(body, options.secret);

  let attempts = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Passport-Event": options.event,
          "X-Passport-Signature": signature,
        },
        body: bodyStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok || (res.status >= 200 && res.status < 300)) {
        return { delivered: true, attempts };
      }

      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxAttempts) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    delivered: false,
    attempts,
    deadLetter: true,
    error: lastError,
  };
}

/**
 * Asynchronously dispatches webhooks to all active subscriptions for the operator.
 */
export async function dispatchWebhook(
  operatorId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
) {
  try {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { operatorId, active: true, events: { has: event } },
    });

    for (const sub of subscriptions) {
      // Background non-blocking execution with retry
      deliverWebhookWithRetry({
        url: sub.url,
        secret: sub.secret,
        event,
        payload,
      }).catch((err) => {
        console.warn(`Webhook delivery failure for sub ${sub.id}:`, err);
      });
    }
  } catch (err) {
    console.warn("Failed to query webhook subscriptions for dispatch:", err);
  }
}

export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "whsec_" + bytesToHex(bytes);
}
