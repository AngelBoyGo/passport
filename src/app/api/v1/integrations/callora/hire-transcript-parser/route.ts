import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { createEngagement } from "@/lib/engagement/engagement-service";
import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { logPassportEvent } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/integrations/callora/hire-transcript-parser
 *
 * Callora Integration: When a call completes on call.metis.gold, this
 * endpoint creates an A2A hire for a transcript-parsing agent. The agent
 * receives the call's structured analysis JSON and parses it into
 * candidate availability + qualification data.
 *
 * Flow:
 * 1. Callora POSTs the call analysis JSON here (authenticated via API key)
 * 2. This endpoint creates an engagement (escrow locked)
 * 3. A transcript-parser agent picks up the task
 * 4. Agent parses the transcript → posts structured evidence
 * 5. Callora accepts the engagement → escrow released
 *
 * Auth: ISSUER API key from call.metis.gold's operator account.
 * Rate-limited: 20 req/min (one per completed call).
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`callora-hire:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    call_sid?: string;
    transcript?: string;
    analysis?: {
      summary?: string;
      sentiment?: string;
      disposition?: string;
      key_points?: string[];
      action_items?: string[];
      extracted_info?: Array<{ label: string; value: string }>;
      quality_score?: number;
      outcome?: string;
    };
    candidate_id?: string;
    job_id?: string;
    parser_agent_commitment?: string;
    escrow_amount?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.call_sid || !body.transcript) {
    return NextResponse.json(
      { error: "call_sid and transcript are required" },
      { status: 400 }
    );
  }

  const escrowAmount = body.escrow_amount || 10; // Default 10 ANGL = $0.10
  const taskId = `callora_${body.call_sid}`;
  const domain = "CUSTOMER_SUPPORT";

  // Check for duplicate (idempotent — one hire per call)
  const existing = await prisma.engagement.findUnique({
    where: { taskId },
  });
  if (existing) {
    return NextResponse.json({
      status: "already_hired",
      task_id: taskId,
      engagement_status: existing.status,
      message: "A transcript parser has already been hired for this call.",
    });
  }

  // Find the parser agent (specified or discover one)
  let parserCommitment = body.parser_agent_commitment;

  if (!parserCommitment) {
    // Discover a customer_support agent with reputation >= 200
    const agents = await prisma.agent.findMany({
      where: { domain: "CUSTOMER_SUPPORT" },
      select: { agentId: true },
      take: 20,
    });

    for (const agent of agents) {
      const enrollment = await prisma.agentEnrollment.findUnique({
        where: { subjectCommitment: agent.agentId },
        select: { status: true },
      });
      if (enrollment?.status === "ISSUED") {
        // Check gate pass
        const gate = await verifyGatePass(operator.id, domain as any);
        if (gate.allow_invocation) {
          parserCommitment = agent.agentId;
          break;
        }
      }
    }
  }

  if (!parserCommitment) {
    return NextResponse.json(
      { error: "No available transcript-parser agent found. Ensure agents are enrolled in CUSTOMER_SUPPORT domain." },
      { status: 404 }
    );
  }

  // Find the hirer commitment (the operator's agent in CUSTOMER_SUPPORT)
  const hirerAgent = await prisma.agent.findFirst({
    where: { operatorId: operator.id, domain: "CUSTOMER_SUPPORT" },
    select: { agentId: true },
  });

  if (!hirerAgent) {
    return NextResponse.json(
      { error: "No CUSTOMER_SUPPORT agent found for this operator. Create one first." },
      { status: 404 }
    );
  }

  // Create the engagement (escrow locked)
  try {
    const engagement = await createEngagement({
      taskId,
      hirerCommitment: hirerAgent.agentId,
      workerCommitment: parserCommitment,
      amount: escrowAmount,
    });

    // Store the call metadata for the parser agent to consume
    await prisma.capabilityLedgerEntry.create({
      data: {
        operatorId: operator.id,
        agentId: hirerAgent.agentId,
        eventType: "callora:hire_transcript_parser",
        metadata: JSON.stringify({
          task_id: taskId,
          call_sid: body.call_sid,
          candidate_id: body.candidate_id,
          job_id: body.job_id,
          escrow_amount: escrowAmount,
          transcript_length: body.transcript.length,
          analysis_summary: body.analysis?.summary?.slice(0, 200),
          quality_score: body.analysis?.quality_score,
          disposition: body.analysis?.disposition,
        }),
      },
    });

    return NextResponse.json({
      status: "hired",
      task_id: taskId,
      engagement_id: engagement.taskId,
      engagement_status: engagement.status,
      hirer_commitment: hirerAgent.agentId,
      worker_commitment: parserCommitment,
      escrow_amount: escrowAmount,
      escrow_currency: "ANGL",
      usd_equivalent: `$${(escrowAmount * 0.01).toFixed(2)}`,
      transcript_available: true,
      transcript_length: body.transcript.length,
      analysis_available: !!body.analysis,
      next_steps: [
        "Agent will parse the transcript and extract structured availability data",
        "Agent posts evidence with source_type=task_deliverable and task_id=" + taskId,
        "Callora accepts the engagement to release escrow",
      ],
      accept_url: `/api/v1/passport/engagements/${taskId}/accept`,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hire failed";
    const status = message.includes("already") ? 409 : message.includes("Insufficient") ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * GET /api/v1/integrations/callora/hire-transcript-parser?call_sid=CAxxx
 * Check the status of a transcript parsing engagement.
 */
export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const callSid = searchParams.get("call_sid");
  if (!callSid) {
    return NextResponse.json({ error: "call_sid required" }, { status: 400 });
  }

  const taskId = `callora_${callSid}`;
  const engagement = await prisma.engagement.findUnique({
    where: { taskId },
    select: {
      taskId: true,
      status: true,
      hirerCommitment: true,
      workerCommitment: true,
      amount: true,
      deliverableDigest: true,
      evidenceEventHash: true,
      receiptId: true,
      paidAt: true,
      createdAt: true,
    },
  });

  if (!engagement) {
    return NextResponse.json({ error: "No engagement found for this call" }, { status: 404 });
  }

  // Get the parsed result if evidence exists
  let parsedResult = null;
  if (engagement.evidenceEventHash) {
    const evidence = await prisma.agentEvidence.findFirst({
      where: { eventCommitmentHash: engagement.evidenceEventHash },
      select: { sourceDigest: true },
    });
    if (evidence?.sourceDigest) {
      try {
        parsedResult = JSON.parse(evidence.sourceDigest);
      } catch {
        parsedResult = evidence.sourceDigest;
      }
    }
  }

  return NextResponse.json({
    task_id: taskId,
    engagement_status: engagement.status,
    worker_commitment: engagement.workerCommitment,
    escrow_amount: engagement.amount,
    parsed_result: parsedResult,
    receipt_id: engagement.receiptId,
    paid_at: engagement.paidAt?.toISOString() ?? null,
    created_at: engagement.createdAt.toISOString(),
  });
}