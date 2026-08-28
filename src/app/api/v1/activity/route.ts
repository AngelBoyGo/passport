import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

interface ActivityEvent {
  type: "evidence" | "receipt" | "enrollment";
  agent: string;
  description: string;
  timestamp: string;
  link?: string;
}

/**
 * GET /api/v1/activity — public live feed of recent agent activity.
 * Returns the 20 most recent events across evidence, receipts, and enrollments.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`activity:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
    );
  }

  const [recentEvidence, recentReceipts, recentEnrollments] = await Promise.all([
    prisma.agentEvidence.findMany({
      take: 10,
      orderBy: { observedAt: "desc" },
      select: {
        agentIdentityCommitment: true,
        normalizedEventType: true,
        sourceType: true,
        observedAt: true,
      },
    }),
    prisma.receipt.findMany({
      take: 10,
      orderBy: { issuedAt: "desc" },
      where: { status: { not: "pending" } },
      select: {
        receiptId: true,
        agentId: true,
        status: true,
        domain: true,
        issuedAt: true,
      },
    }),
    prisma.agentEnrollment.findMany({
      take: 5,
      orderBy: { issuedAt: "desc" },
      where: { status: "ISSUED" },
      select: {
        subjectCommitment: true,
        issuedAt: true,
      },
    }),
  ]);

  const events: ActivityEvent[] = [];

  for (const ev of recentEvidence) {
    events.push({
      type: "evidence",
      agent: ev.agentIdentityCommitment.slice(0, 12),
      description: `${formatEventType(ev.normalizedEventType)} via ${ev.sourceType}`,
      timestamp: ev.observedAt.toISOString(),
      link: `/profiles/${ev.agentIdentityCommitment}`,
    });
  }

  for (const r of recentReceipts) {
    events.push({
      type: "receipt",
      agent: r.agentId.slice(0, 12),
      description: `Receipt ${r.status}${r.domain ? ` in ${r.domain}` : ""}`,
      timestamp: r.issuedAt.toISOString(),
      link: `/verify/${r.receiptId}`,
    });
  }

  for (const e of recentEnrollments) {
    if (e.issuedAt) {
      events.push({
        type: "enrollment",
        agent: e.subjectCommitment.slice(0, 12),
        description: "Agent enrolled",
        timestamp: e.issuedAt.toISOString(),
        link: `/profiles/${e.subjectCommitment}`,
      });
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const top = events.slice(0, 20);

  return NextResponse.json({ events: top, timestamp: new Date().toISOString() });
}

function formatEventType(type: string): string {
  switch (type) {
    case "AGENT_ARTIFACT_CREATED": return "Artifact created";
    case "VALIDATION_OBSERVED": return "Validated";
    case "HUMAN_CORRECTION_OBSERVED": return "Corrected";
    case "EXECUTION_FAILURE_OBSERVED": return "Failure";
    case "AGENT_RUN_OBSERVED": return "Run observed";
    default: return type;
  }
}