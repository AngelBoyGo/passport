import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { createReceiptCheckpoint } from "@/lib/receipt/merkle-checkpoint";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized: No valid session token found" }, { status: 401 });
  }

  const operatorId = session.operatorId;

  const [
    operator,
    apiKeys,
    agents,
    recentReceipts,
    totalReceipts,
    webhookCount,
    checkpoint,
    dataCenterEvidence,
  ] = await Promise.all([
    prisma.operator.findUnique({
      where: { id: operatorId },
      select: {
        id: true,
        email: true,
        credits: true,
        tier: true,
        accountStatus: true,
        stakeBalanceCents: true,
      },
    }),
    prisma.apiKey.findMany({
      where: { operatorId },
      select: { id: true, keyHash: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agent.findMany({
      where: { operatorId },
      select: { id: true, agentId: true, domain: true, createdAt: true },
    }),
    prisma.receipt.findMany({
      where: { operatorId },
      take: 20,
      orderBy: { issuedAt: "desc" },
      select: {
        receiptId: true,
        issuedAt: true,
        status: true,
        domain: true,
        agentId: true,
        inputDigest: true,
        contentHash: true,
        signature: true,
        authorityScope: true,
      },
    }),
    prisma.receipt.count({ where: { operatorId } }),
    prisma.webhookSubscription.count({ where: { operatorId } }),
    createReceiptCheckpoint(),
    prisma.agentEvidence.findMany({
      where: { sourceType: { in: ["datacenter_telemetry", "datacet_control_plane", "hardware_telemetry"] } },
      take: 50,
      orderBy: { observedAt: "desc" },
    }),
  ]);

  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  // Calculate DataCenter specific metrics if available
  let hwVerified = 0;
  let dcEvents = dataCenterEvidence.length;
  let powerDeltaSum = 0;
  let powerDeltaCount = 0;
  let energySavedKwh = 0;
  let carbonAvoidedKg = 0;
  let champion = "active_setpoint";

  for (const ev of dataCenterEvidence) {
    if (ev.validationSignalPresent) hwVerified++;
    if (ev.sourceDigest) {
      try {
        const d = JSON.parse(ev.sourceDigest);
        if (typeof d.delta_power_pct === "number" && d.origin === "live-instrument") {
          powerDeltaSum += d.delta_power_pct;
          powerDeltaCount++;
        }
        if (typeof d.energy_saved_kwh === "number") energySavedKwh += d.energy_saved_kwh;
        if (typeof d.carbon_avoided_kg === "number") carbonAvoidedKg += d.carbon_avoided_kg;
        if (d.policy_setpoint_applied && d.origin === "live-instrument") champion = d.policy_setpoint_applied;
      } catch {}
    }
  }

  const dcScorecard = {
    total_events: dcEvents,
    hardware_verified_events: hwVerified,
    hardware_verification_ratio: dcEvents > 0 ? Number((hwVerified / dcEvents).toFixed(2)) : 0,
    acting_champion_policy: dcEvents > 0 ? champion : "None",
    avg_power_reduction_pct: powerDeltaCount > 0 ? Number((powerDeltaSum / powerDeltaCount).toFixed(2)) : 0,
    cumulative_energy_saved_kwh: Number(energySavedKwh.toFixed(2)),
    cumulative_carbon_avoided_kg: Number(carbonAvoidedKg.toFixed(2)),
  };

  let pubKey = "";
  try {
    pubKey = getPublicKeyHex();
  } catch {}

  return NextResponse.json({
    operator,
    metrics: {
      total_receipts: totalReceipts,
      // Evidence total is intentionally scoped (removed the global count that
      // leaked cross-tenant volume to any logged-in user).
      total_evidence: 0,
      enrolled_agents_count: agents.length,
      webhooks_active_count: webhookCount,
    },
    api_keys: apiKeys,
    agents,
    recent_receipts: recentReceipts,
    datacenter: dcScorecard,
    merkle_root: checkpoint.merkle_root,
    merkle_checkpoint_id: checkpoint.checkpoint_id,
    public_verifying_key: pubKey,
    timestamp: new Date().toISOString(),
  });
}
