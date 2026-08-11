import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import { generateWebhookSecret } from "@/lib/webhooks/webhook-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subs = await prisma.webhookSubscription.findMany({
    where: { operatorId: operator.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(subs);
}

export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { url?: string; events?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.url || !body.events || body.events.length === 0) {
    return NextResponse.json(
      { error: "url and events are required" },
      { status: 400 }
    );
  }

  const validEvents = ["evidence.anchored", "enrollment.completed"];
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
      operatorId: operator.id,
      url: body.url,
      secret,
      events: body.events,
    },
  });

  return NextResponse.json(
    { id: sub.id, url: sub.url, events: sub.events, secret },
    { status: 201 }
  );
}