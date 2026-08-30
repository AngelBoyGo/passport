import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { createEngagement } from "@/lib/engagement/engagement-service";
import { logPassportEvent } from "@/lib/observability/logger";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { hireWorker, type HireServiceDeps, type HireInput } from "@/lib/a2a/hire-service";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW = 60_000;

/**
 * POST /api/v1/a2a/hire — Agent-to-Agent Autonomous Hiring Protocol.
 *
 * Chains: identity verification → gate check → escrow lock → engagement → receipt.
 * Any agent with a valid API key can hire any other agent autonomously.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`a2a-hire:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", error_code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  // Authenticate the calling agent
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized", error_code: "invalid_signature" }, { status: 401 });
  }

  let body: HireInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", error_code: "invalid_commitment" }, { status: 400 });
  }

  // Ensure the caller is the hirer
  const callerAgents = await prisma.agent.findMany({
    where: { operatorId: operator.id },
    select: { agentId: true },
  });
  const callerCommitments = callerAgents.map((a) => a.agentId);
  const isCallerHirer = callerCommitments.some(
    (c) => c.toLowerCase() === body.hirer_commitment?.toLowerCase()
  );
  if (!isCallerHirer) {
    return NextResponse.json(
      { error: "Forbidden: you can only hire as your own agent", error_code: "invalid_signature" },
      { status: 403 }
    );
  }

  // Resolve the hirer's public key for signature verification
  const hirerEnrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: body.hirer_commitment?.toLowerCase() },
    select: { publicKey: true },
  });

  // Build injected dependencies
  const deps: HireServiceDeps = {
    verifySignature: async (message: string, signature: string) => {
      if (!hirerEnrollment?.publicKey) return false;
      try {
        return await verify(
          hexToBytes(signature),
          hexToBytes(message),
          hexToBytes(hirerEnrollment.publicKey)
        );
      } catch {
        return false;
      }
    },
    verifyGatePass: async (operatorId: string, domain: string) => {
      return verifyGatePass(operatorId, domain as any);
    },
    createEngagement: async (input) => {
      const engagement = await createEngagement(input);
      return { taskId: engagement.taskId, status: engagement.status };
    },
    findWorker: async (commitment) => {
      const enrollment = await prisma.agentEnrollment.findUnique({
        where: { subjectCommitment: commitment.toLowerCase() },
        select: { status: true, publicKey: true },
      });
      if (!enrollment || enrollment.status !== "ISSUED") return null;
      const agent = await prisma.agent.findFirst({
        where: { agentId: commitment.toLowerCase() },
        select: { operatorId: true },
      });
      return {
        operatorId: agent?.operatorId ?? "",
        commitment: commitment.toLowerCase(),
        enrolled: true,
      };
    },
    findHirer: async (commitment) => {
      const agent = await prisma.agent.findFirst({
        where: { agentId: commitment.toLowerCase() },
        select: { operatorId: true },
      });
      if (!agent) return null;
      const op = await prisma.operator.findUnique({
        where: { id: agent.operatorId },
        select: { credits: true },
      });
      return {
        operatorId: agent.operatorId,
        commitment: commitment.toLowerCase(),
        credits: op?.credits ?? 0,
      };
    },
    logAudit: async (operatorId, action, targetId, details) => {
      await prisma.adminAuditLog.create({
        data: { operatorId, action, targetId, details },
      }).catch(() => {});
    },
    logEvent: (event) => {
      logPassportEvent(event as any);
    },
    isRateLimited: (key: string) => {
      return !checkInMemoryRateLimit(key, 30, 60_000).allowed;
    },
  };

  const result = await hireWorker(body, deps);

  if (!result.success) {
    const statusMap: Record<string, number> = {
      insufficient_escrow: 402,
      gate_denied: 403,
      duplicate_proposal: 409,
      invalid_signature: 401,
      invalid_commitment: 400,
      worker_not_found: 404,
      self_hire: 400,
      negative_amount: 400,
      past_expiry: 400,
      rate_limited: 429,
      internal_error: 500,
    };
    const status = statusMap[result.error_code ?? "internal_error"] ?? 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
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