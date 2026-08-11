import { prisma } from "@/lib/db";

type WebhookEvent = "evidence.anchored" | "enrollment.completed";

export async function dispatchWebhook(
  operatorId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
) {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { operatorId, active: true, events: { has: event } },
  });

  for (const sub of subscriptions) {
    fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Passport-Event": event,
        "X-Passport-Signature": sub.secret,
      },
      body: JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() }),
    }).catch(() => {
      // Silent failure — webhook delivery is best-effort
    });
  }
}

export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}