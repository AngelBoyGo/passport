import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { createReceiptCheckpoint } from "@/lib/receipt/merkle-checkpoint";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`datacenter:receipts:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const { searchParams } = new URL(request.url);
  const eventType = searchParams.get("event_type") || undefined;
  const origin = searchParams.get("origin") || undefined;
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

  const whereClause: any = {
    sourceType: "datacet_control_plane",
  };

  if (eventType) {
    whereClause.normalizedEventType = eventType;
  }
  if (origin === "live-instrument") {
    whereClause.validationSignalPresent = true;
  } else if (origin === "synthetic") {
    whereClause.validationSignalPresent = false;
  }

  const [evidenceRecords, checkpoint] = await Promise.all([
    prisma.agentEvidence.findMany({
      where: whereClause,
      take: limit,
      orderBy: { observedAt: "desc" },
      include: {
        evidenceReceiptLinks: {
          select: {
            receiptId: true,
            receiptCommitmentHash: true,
            attributionMode: true,
          },
        },
      },
    }),
    createReceiptCheckpoint(),
  ]);

  const receipts = evidenceRecords.map((ev: {
    id: string;
    eventCommitmentHash: string;
    normalizedEventType: string;
    observedAt: Date;
    validationSignalPresent: boolean;
    sourceDigest: string | null;
    evidenceReceiptLinks?: { receiptId: string; attributionMode: string }[];
  }) => {
    let payload = {};
    try {
      if (ev.sourceDigest) payload = JSON.parse(ev.sourceDigest);
    } catch {}

    const link = ev.evidenceReceiptLinks?.[0];

    return {
      event_commitment_hash: ev.eventCommitmentHash,
      receipt_id: link?.receiptId ?? `rcpt_dc_${ev.id.slice(0, 16)}`,
      event_type: ev.normalizedEventType,
      observed_at: ev.observedAt.toISOString(),
      validation_signal_present: ev.validationSignalPresent,
      origin: ev.validationSignalPresent ? "live-instrument" : "synthetic",
      attribution_mode: link?.attributionMode ?? (ev.validationSignalPresent ? "LIVE_HARDWARE_INSTRUMENTED" : "SIMULATION_MODELED"),
      telemetry: payload,
    };
  });

  return NextResponse.json(
    {
      count: receipts.length,
      merkle_root: checkpoint.merkle_root,
      checkpoint_interval: "realtime",
      receipts,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
