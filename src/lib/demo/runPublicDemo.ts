import { ErrorTranche, OperationalDomain, OperatorAccountStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { MINIMUM_ESCROW_FLOOR_CENTS } from "@/lib/escrow/constants";
import {
  ensureAgent,
  ensureOperator,
  operatorIdFromStripe,
} from "@/lib/operator";
import { sha256Hex } from "@/lib/receipt/canonical";
import {
  dbReceiptToPayload,
  finalizeReceipt,
  issueReceipt,
} from "@/lib/receipt-service";
import { verifyReceipt } from "@/lib/receipt/verify";

export const DEMO_STRIPE_CUSTOMER_ID = "cus_passport_site_demo";
export const DEMO_AGENT_ID = "demo-agent-1";
export const DEMO_AUTHORITY_SCOPE = "fulfillment.demo";
export const DEMO_DOMAIN = OperationalDomain.SYSTEM_INTEGRATION;
const MIN_SEED_COUNT = 5;
/** Demo escrow bond — above enterprise floor for slashing headroom in public demos. */
export const DEMO_ESCROW_CENTS = 50_000;

/**
 * Ensures the public demo operator meets the minimum escrow bond gate requirement.
 */
export async function ensureDemoEscrowBond(operatorDbId: string): Promise<void> {
  const operator = await prisma.operator.findUnique({
    where: { id: operatorDbId },
    select: { stakeBalanceCents: true },
  });
  if (!operator) {
    throw new Error("Demo operator not found");
  }
  if (operator.stakeBalanceCents >= MINIMUM_ESCROW_FLOOR_CENTS) {
    return;
  }

  await prisma.operator.update({
    where: { id: operatorDbId },
    data: {
      stakeBalanceCents: DEMO_ESCROW_CENTS,
      accountStatus: OperatorAccountStatus.ACTIVE,
    },
  });
}

const demoReceiptSelect = {
  receiptId: true,
  issuedAt: true,
  operatorId: true,
  agentId: true,
  receiptType: true,
  status: true,
  inputDigest: true,
  authorityScope: true,
  expiry: true,
  revocationStatus: true,
  outputHash: true,
  refusalReason: true,
  terminalReason: true,
  prevReceiptHash: true,
  contentHash: true,
  signature: true,
  domain: true,
  domainCommitment: true,
  blindSalt: true,
  errorTranche: true,
} as const;

/**
 * Removes legacy demo receipts that fail signature verification so chain history stays coherent.
 */
export async function pruneInvalidDemoReceipts(
  operatorDbId: string
): Promise<void> {
  const operatorId = operatorIdFromStripe(DEMO_STRIPE_CUSTOMER_ID);
  const demoReceipts = await prisma.receipt.findMany({
    where: {
      operatorId: operatorDbId,
      agentId: DEMO_AGENT_ID,
      authorityScope: DEMO_AUTHORITY_SCOPE,
      status: { not: "pending" },
    },
    select: demoReceiptSelect,
  });

  const invalidIds: string[] = [];
  for (const row of demoReceipts) {
    const payload = dbReceiptToPayload({ ...row, operatorId });
    const result = await verifyReceipt(payload);
    if (!result.valid) {
      invalidIds.push(row.receiptId);
    }
  }

  if (invalidIds.length > 0) {
    await prisma.receipt.deleteMany({
      where: { receiptId: { in: invalidIds } },
    });
  }
}

/**
 * Seeds clean domain history so the public demo can pass the issuance gate.
 */
export async function ensureDemoGateHistory(operatorDbId: string): Promise<void> {
  const gate = await verifyGatePass(operatorDbId, DEMO_DOMAIN);
  if (gate.allow_invocation) {
    return;
  }

  if (gate.reason !== "ZERO_TENANCY_REJECT") {
    throw new Error(`Demo operator gate blocked: ${gate.reason ?? "unknown"}`);
  }

  const existing = await prisma.receipt.count({
    where: { operatorId: operatorDbId, domain: DEMO_DOMAIN },
  });
  if (existing >= MIN_SEED_COUNT) {
    return;
  }

  const agent = await ensureAgent(operatorDbId, DEMO_AGENT_ID, "site.demo");
  const toCreate = MIN_SEED_COUNT - existing;

  for (let i = 0; i < toCreate; i++) {
    const suffix = `${Date.now()}_${i}`;
    const now = new Date(Date.now() - (i + 1) * 1000);
    await prisma.receipt.create({
      data: {
        receiptId: `rcpt_demo_seed_${suffix}`,
        operatorId: operatorDbId,
        agentId: DEMO_AGENT_ID,
        agentRecordId: agent.id,
        receiptType: "competence",
        status: "success",
        inputDigest: `digest_${suffix}`,
        authorityScope: "site.demo.seed",
        expiry: new Date(now.getTime() + 86_400_000),
        contentHash: `hash_${suffix}`,
        finalizedAt: now,
        issuedAt: now,
        domain: DEMO_DOMAIN,
        errorTranche: ErrorTranche.NONE,
      },
    });
  }
}

/**
 * Issues and finalizes a demo receipt for the public landing page.
 */
export async function runPublicDemo(): Promise<{ receipt_id: string }> {
  const operator = await ensureOperator(
    DEMO_STRIPE_CUSTOMER_ID,
    "demo@passport.local"
  );

  await ensureDemoEscrowBond(operator.id);
  await ensureDemoGateHistory(operator.id);
  await pruneInvalidDemoReceipts(operator.id);

  const lastDemo = await prisma.receipt.findFirst({
    where: {
      operatorId: operator.id,
      agentId: DEMO_AGENT_ID,
      authorityScope: DEMO_AUTHORITY_SCOPE,
      status: { not: "pending" },
    },
    orderBy: { issuedAt: "desc" },
    select: { contentHash: true },
  });

  const inputDigest = sha256Hex("demo task: ship order #1234");
  const expiry = new Date(Date.now() + 30 * 86400000).toISOString();

  const { signed: pending } = await issueReceipt(operator.id, {
    operator_id: operatorIdFromStripe(DEMO_STRIPE_CUSTOMER_ID),
    agent_id: DEMO_AGENT_ID,
    receipt_type: "competence",
    input_digest: inputDigest,
    authority_scope: DEMO_AUTHORITY_SCOPE,
    expiry,
    domain: DEMO_DOMAIN,
    prev_receipt_hash: lastDemo?.contentHash,
  });

  const outputHash = sha256Hex("shipped via carrier XYZ");
  const { signed: finalized } = await finalizeReceipt(
    operator.id,
    pending.receipt_id,
    {
      status: "success",
      output_hash: outputHash,
    }
  );

  return { receipt_id: finalized.receipt_id };
}
