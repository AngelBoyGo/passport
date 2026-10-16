import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";
import { bridgeEvidenceToReceipt } from "@/lib/evidence-bridge/evidence-receipt-bridge";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/admin/bridge-evidence — backfill/one-shot: convert recent UNLINKED
 * AgentEvidence rows into signed custody receipts via the evidence→receipt
 * bridge. Gated by SCHEDULER_SECRET (x-scheduler-secret / x-cron-secret).
 *
 * Why this exists: the bridge normally runs INLINE only when
 * EVIDENCE_BRIDGE_AUTO_ENABLED=true and EVIDENCE_BRIDGE_OPERATOR_ID is set —
 * the wiring had been absent, so ~1.8k evidence rows produced 0 receipts. This
 * endpoint wires the bridge for the existing backlog. It is idempotent (the
 * bridge dedups on eventCommitmentHash).
 */
export async function POST(request: NextRequest) {
  const provided =
    request.headers.get("x-scheduler-secret") || request.headers.get("x-cron-secret");
  if (!isSchedulerAuthorized(provided, process.env.SCHEDULER_SECRET, process.env.NODE_ENV)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  if (!process.env.EVIDENCE_BRIDGE_OPERATOR_ID) {
    return NextResponse.json(
      { error: "EVIDENCE_BRIDGE_OPERATOR_ID is not set" },
      { status: 409, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { limit?: number; sourceType?: string };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
  const sourceType = typeof body.sourceType === "string" && body.sourceType ? body.sourceType : undefined;

  const evidence = await prisma.agentEvidence.findMany({
    where: {
      ...(sourceType ? { sourceType } : {}),
      evidenceReceiptLinks: { none: {} },
    },
    orderBy: { observedAt: "desc" },
    take: limit,
    select: {
      id: true,
      sourceType: true,
      agentIdentityCommitment: true,
      eventCommitmentHash: true,
      normalizedEventType: true,
      rawErrorClassification: true,
      validationSignalPresent: true,
      observedAt: true,
    },
  });

  let created = 0;
  const errors: string[] = [];
  for (const e of evidence) {
    try {
      const link = await bridgeEvidenceToReceipt({
        id: e.id,
        sourceType: e.sourceType,
        agentIdentityCommitment: e.agentIdentityCommitment,
        eventCommitmentHash: e.eventCommitmentHash,
        normalizedEventType: e.normalizedEventType,
        rawErrorClassification: e.rawErrorClassification ?? null,
        validationSignalPresent: e.validationSignalPresent,
        observedAt: e.observedAt,
      });
      if (link) created++;
    } catch (err) {
      errors.push(`${e.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const total_receipts = await prisma.receipt.count();
  return NextResponse.json(
    { attempted: evidence.length, created, errors: errors.slice(0, 10), total_receipts },
    { headers: NO_STORE }
  );
}
