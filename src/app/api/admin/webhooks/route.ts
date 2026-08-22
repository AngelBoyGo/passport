import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";
import { generateWebhookSecret } from "@/lib/webhooks/webhook-service";
import { validateWebhookUrl } from "@/lib/security/ssrf";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const subs = await prisma.webhookSubscription.findMany({
    where: { operatorId: session.operator.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(subs, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: { url?: string; events?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.url || !body.events || body.events.length === 0) {
    return NextResponse.json({ error: "url and events are required" }, { status: 400 });
  }

  const urlError = validateWebhookUrl(body.url);
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400, headers: NO_STORE });
  }

  const validEvents = [
    "evidence.anchored",
    "enrollment.completed",
    "reputation.degraded",
    "reputation.restored",
    "reputation.milestone",
  ];
  const invalidEvents = body.events.filter((e) => !validEvents.includes(e));
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      { error: `Invalid events: ${invalidEvents.join(", ")}. Valid: ${validEvents.join(", ")}` },
      { status: 400 }
    );
  }

  const secret = generateWebhookSecret();
  const sub = await prisma.webhookSubscription.create({
    data: {
      operatorId: session.operator.id,
      url: body.url,
      secret,
      events: body.events,
    },
  });

  return NextResponse.json(
    { id: sub.id, url: sub.url, events: sub.events, secret },
    { status: 201, headers: NO_STORE }
  );
}
