import { NextRequest, NextResponse } from "next/server";
import {
  ingestDataCenterTelemetry,
  type DataCenterTelemetryPayload,
} from "@/lib/datacenter/datacenter-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/receipt/canonical";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`datacenter:evidence:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  let operatorId: string | undefined;
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const rawKey = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (rawKey.startsWith("pp_")) {
      const keyHash = sha256Hex(rawKey);
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
        select: { operatorId: true },
      });
      if (apiKey) {
        operatorId = apiKey.operatorId;
      }
    }
  }

  try {
    const body = (await request.json()) as DataCenterTelemetryPayload;

    if (!body.cluster_id || !body.event_type || !body.origin) {
      return NextResponse.json(
        { error: "Missing required fields: cluster_id, event_type, origin" },
        { status: 400 }
      );
    }

    const result = await ingestDataCenterTelemetry(body, operatorId);

    return NextResponse.json(result, {
      status: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
