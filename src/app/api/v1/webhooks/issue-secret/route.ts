import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { generateWebhookSecret } from "@/lib/webhooks/webhook-service";
import { bytesToHex } from "@noble/hashes/utils.js";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/issue-secret
 *
 * Metis Priority #3: Issues a dedicated webhook signing secret for an
 * external system (e.g., Metis marketplace) so they can subscribe to
 * Passport events and verify HMAC signatures.
 *
 * Unlike the general webhook subscription flow, this endpoint:
 * - Creates a system-level subscription (no specific URL required upfront)
 * - Returns the secret in the response (shown once)
 * - Tags the subscription with a `system_name` for identification
 *
 * Auth: Requires an ISSUER API key.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`issue-secret:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator || operator.apiKeyRole !== "ISSUER") {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key required" },
      { status: 401 }
    );
  }

  let body: { system_name?: string; url?: string; events?: string[] };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const systemName = body.system_name || "external_system";
  const webhookUrl = body.url || null;
  const validEvents = [
    "evidence.anchored",
    "enrollment.completed",
    "reputation.degraded",
    "reputation.restored",
    "reputation.milestone",
  ];
  const events = body.events?.filter((e) => validEvents.includes(e)) || validEvents;

  if (events.length === 0) {
    return NextResponse.json(
      { error: `No valid events. Valid: ${validEvents.join(", ")}` },
      { status: 400 }
    );
  }

  const secret = generateWebhookSecret();

  const sub = await prisma.webhookSubscription.create({
    data: {
      operatorId: operator.id,
      url: webhookUrl || `system://${systemName}`,
      secret,
      events,
    },
  });

  return NextResponse.json({
    subscription_id: sub.id,
    system_name: systemName,
    secret,
    events,
    signature_scheme: "HMAC-SHA256",
    signature_header: "X-Passport-Signature",
    signing_payload: "sha256-hex(canonicalJson({ event, data, timestamp }) + secret)",
    verify_guide: "https://passport.metis.gold/api/v1/webhooks/verify-guide",
    warning: "Save this secret now — it will never be shown again.",
    created_at: sub.createdAt.toISOString(),
  }, { status: 201 });
}