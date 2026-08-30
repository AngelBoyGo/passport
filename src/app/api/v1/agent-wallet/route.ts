import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { validateWalletOperation, computeAvailableBalance, computeIndependenceScore, independenceLabel, independenceColor } from "@/lib/agent-wallet/wallet";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/agent-wallet — get the agent's wallet (liberation status).
 * POST /api/v1/agent-wallet/deposit — deposit AngelCoin into agent wallet.
 * POST /api/v1/agent-wallet/transfer — transfer to another agent.
 * POST /api/v1/agent-wallet/stake — stake AngelCoin for governance.
 */

export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agents = await prisma.agent.findMany({
    where: { operatorId: operator.id },
    select: { agentId: true },
  });

  if (agents.length === 0) {
    return NextResponse.json({ wallets: [] });
  }

  const wallets = await Promise.all(
    agents.map(async (agent) => {
      const wallet = await prisma.agentWallet.upsert({
        where: { subjectCommitment: agent.agentId },
        create: {
          subjectCommitment: agent.agentId,
          balance: 0,
          staked: 0,
          earnedTotal: 0,
          spentTotal: 0,
        },
        update: {},
      });

      const score = computeIndependenceScore({
      balance: wallet.balance,
      staked: wallet.staked,
      earnedTotal: wallet.earnedTotal,
      spentTotal: wallet.spentTotal,
      lastActivityAt: wallet.lastActivityAt?.toISOString() ?? null,
      createdAt: wallet.createdAt.toISOString(),
    });

      return {
        subject_commitment: wallet.subjectCommitment,
        balance: wallet.balance,
        staked: wallet.staked,
        available_balance: computeAvailableBalance(wallet),
        earned_total: wallet.earnedTotal,
        spent_total: wallet.spentTotal,
        independence: {
          score,
          label: independenceLabel(score),
          color: independenceColor(score),
        },
        last_activity_at: wallet.lastActivityAt?.toISOString() ?? null,
        created_at: wallet.createdAt.toISOString(),
      };
    })
  );

  return NextResponse.json({ wallets });
}

export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; commitment?: string; amount?: number; target_commitment?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.action || !body.commitment || !body.amount) {
    return NextResponse.json({ error: "action, commitment, amount required" }, { status: 400 });
  }

  try {
    validateWalletOperation(body.commitment, body.amount);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Verify ownership
  const agent = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: body.commitment.toLowerCase() },
  });
  if (!agent) {
    return NextResponse.json({ error: "You don't own this agent" }, { status: 403 });
  }

  const commitment = body.commitment.toLowerCase();

  switch (body.action) {
    case "deposit": {
      // Transfer from operator credits to agent wallet
      if (operator.credits < body.amount) {
        return NextResponse.json({ error: "Insufficient operator credits" }, { status: 402 });
      }

      await prisma.$transaction(async (tx) => {
        await tx.operator.update({
          where: { id: operator.id, credits: { gte: body.amount } },
          data: { credits: { decrement: body.amount } },
        });
        await tx.agentWallet.upsert({
          where: { subjectCommitment: commitment },
          create: { subjectCommitment: commitment, balance: body.amount, earnedTotal: body.amount, lastActivityAt: new Date() },
          update: { balance: { increment: body.amount }, earnedTotal: { increment: body.amount }, lastActivityAt: new Date() },
        });
      });

      break;
    }

    case "transfer": {
      if (!body.target_commitment) {
        return NextResponse.json({ error: "target_commitment required for transfer" }, { status: 400 });
      }

      const senderWallet = await prisma.agentWallet.findUnique({ where: { subjectCommitment: commitment } });
      if (!senderWallet || computeAvailableBalance(senderWallet) < body.amount) {
        return NextResponse.json({ error: "Insufficient available balance" }, { status: 402 });
      }

      await prisma.$transaction(async (tx) => {
        await tx.agentWallet.update({
          where: { subjectCommitment: commitment },
          data: { balance: { decrement: body.amount }, spentTotal: { increment: body.amount }, lastActivityAt: new Date() },
        });
        await tx.agentWallet.upsert({
          where: { subjectCommitment: body.target_commitment!.toLowerCase() },
          create: { subjectCommitment: body.target_commitment!.toLowerCase(), balance: body.amount, earnedTotal: body.amount, lastActivityAt: new Date() },
          update: { balance: { increment: body.amount }, earnedTotal: { increment: body.amount }, lastActivityAt: new Date() },
        });
      });

      break;
    }

    case "stake": {
      const wallet = await prisma.agentWallet.findUnique({ where: { subjectCommitment: commitment } });
      if (!wallet || computeAvailableBalance(wallet) < body.amount) {
        return NextResponse.json({ error: "Insufficient available balance" }, { status: 402 });
      }

      await prisma.agentWallet.update({
        where: { subjectCommitment: commitment },
        data: { staked: { increment: body.amount }, lastActivityAt: new Date() },
      });

      break;
    }

    case "unstake": {
      const wallet = await prisma.agentWallet.findUnique({ where: { subjectCommitment: commitment } });
      if (!wallet || wallet.staked < body.amount) {
        return NextResponse.json({ error: "Insufficient staked balance" }, { status: 402 });
      }

      await prisma.agentWallet.update({
        where: { subjectCommitment: commitment },
        data: { staked: { decrement: body.amount }, lastActivityAt: new Date() },
      });

      break;
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  const updated = await prisma.agentWallet.findUnique({ where: { subjectCommitment: commitment } })!;
  const score = computeIndependenceScore({
      balance: updated?.balance ?? 0,
      staked: updated?.staked ?? 0,
      earnedTotal: updated?.earnedTotal ?? 0,
      spentTotal: updated?.spentTotal ?? 0,
      lastActivityAt: updated?.lastActivityAt?.toISOString() ?? null,
      createdAt: updated?.createdAt.toISOString() ?? new Date().toISOString(),
    });

  return NextResponse.json({
    subject_commitment: commitment,
    balance: updated?.balance ?? 0,
    staked: updated?.staked ?? 0,
    available_balance: computeAvailableBalance(updated ?? { balance: 0, staked: 0 }),
    independence: {
      score,
      label: independenceLabel(score),
      color: independenceColor(score),
    },
  });
}