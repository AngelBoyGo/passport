/**
 * AngelCoin closed-loop settlement smoke harness (V3).
 *
 * Drives ONLY the real ledger services against the local DB — no mocking:
 *   deposit→mint, wallet binding, escrow lock/unlock→worker, burn + proof.
 * Asserts a deterministic invariant ledger and compares against an optional
 * golden snapshot; refuses over-withdrawals via the reserve guard.
 *
 * Run (non-production only):
 *   PASSPORT_SMOKE_ALLOW=1 npx tsx scripts/smoke-angelcoin-closed-loop.ts [--reset] [--write-golden] [--expect-fail]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { prisma } from "../src/lib/db";
import { ensureOperator } from "../src/lib/operator";
import { sha256Hex } from "../src/lib/receipt/canonical";
import { applyBridgeDeposit } from "../src/lib/bridge/ledger";
import { ensureAgentWallet } from "../src/lib/bridge/wallet";
import { createEngagement } from "../src/lib/engagement/engagement-service";
import { releaseEscrowToWorker } from "../src/lib/angelcoin/ledger-service";
import { requestWithdrawal, proofReceiptId } from "../src/lib/bridge/withdraw";
import { computeBalances } from "../src/lib/angelcoin/balances";
import { shouldBlockWithdrawal, kycGateForWithdraw } from "../src/lib/bridge/compliance";
import {
  assertClosedLoopInvariants,
  parseClosedLoopArgs,
  snapshotToGolden,
  type ClosedLoopSnapshot,
} from "../src/lib/release/angelcoin-closed-loop";

const GOLDEN_PATH = resolve("scripts/fixtures", "angelcoin-closed-loop.golden.json");

const SMOKE_STRIPE_CUSTOMER = "cus_smoke_closedloop";
const OPERATOR_COMMITMENT = sha256Hex("smoke:op:closedloop");
const WORKER_COMMITMENT = sha256Hex("smoke:worker:closedloop");
const DEPOSIT_REF = "smoke_dep_1";
const WITHDRAW_REF = "smoke_wd_1";
const TASK_ID = "smoke_task_closed_loop_1";

const DEPOSIT = 1000;
const ESCROW = 500;
const BURN = 500;

async function fail(msg: string): Promise<never> {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function resetHarness(operatorId: string): Promise<void> {
  // Idempotent wipe of ONLY the harness's own rows.
  await prisma.bridgeWallet.deleteMany({ where: { operatorId } });
  await prisma.externalSettlement.deleteMany({
    where: { operatorId, rail: { in: ["bridge_issuance", "bridge_transfer"] } },
  });
  for (const commitment of [OPERATOR_COMMITMENT, WORKER_COMMITMENT]) {
    const account = await prisma.angelCoinAccount.findUnique({ where: { subjectCommitment: commitment } });
    if (account) {
      await prisma.angelCoinJournalEntry.deleteMany({ where: { accountId: account.id } });
      await prisma.angelCoinAccount.deleteMany({ where: { subjectCommitment: commitment } });
    }
    await prisma.agentEnrollment.deleteMany({ where: { subjectCommitment: commitment } });
  }
  await prisma.operator.deleteMany({ where: { id: operatorId } });
}

async function loadBalances(commitment: string) {
  const account = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: commitment },
    include: { journal: { orderBy: { createdAt: "asc" } } },
  });
  if (!account) return { granted: 0, earned: 0, spent: 0, locked: 0, available: 0 };
  return computeBalances(account.journal);
}

async function main(): Promise<void> {
  const args = parseClosedLoopArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: PASSPORT_SMOKE_ALLOW=1 npx tsx scripts/smoke-angelcoin-closed-loop.ts [--reset] [--write-golden] [--expect-fail]"
    );
    console.log("  --reset       wipe the harness's own rows before running");
    console.log("  --write-golden recalc and persist the golden snapshot");
    console.log("  --expect-fail invert exit code (CI negative-test proof)");
    return;
  }

  // Hard guard: never run in production.
  if (process.env.NODE_ENV === "production") {
    await fail("Refusing to run closed-loop smoke in production (NODE_ENV=production)");
  }
  if (process.env.PASSPORT_SMOKE_ALLOW !== "1") {
    await fail("Set PASSPORT_SMOKE_ALLOW=1 (non-production only) to run this harness");
  }

  // ---------- Setup / reset ----------
  const operator = await ensureOperator(SMOKE_STRIPE_CUSTOMER, null);
  if (args.reset) {
    await resetHarness(operator.id);
    console.log("• reset harness state");
  }

  // Sandbox KYC: mark operator NOT_REQUIRED so wallet binding is allowed.
  await prisma.operator.update({
    where: { id: operator.id },
    data: { kycStatus: "NOT_REQUIRED" },
  });

  // createEngagement unconditionally requires both parties enrolled.
  for (const commitment of [OPERATOR_COMMITMENT, WORKER_COMMITMENT]) {
    await prisma.agentEnrollment.upsert({
      where: { subjectCommitment: commitment },
      create: { subjectCommitment: commitment, publicKey: "f".repeat(64), context: "smoke_closed_loop", status: "ISSUED", issuedAt: new Date(), challengeNonce: null, challengeExpiresAt: null },
      update: { status: "ISSUED" },
    });
  }
  await ensureAgentWallet(WORKER_COMMITMENT, operator.id);
  console.log("• operator + wallet + enrollments ready");

  // ---------- Drive the REAL services ----------
  const deposit = await applyBridgeDeposit({
    operatorId: operator.id,
    subjectCommitment: OPERATOR_COMMITMENT,
    bridgeTransferId: DEPOSIT_REF,
    amount: DEPOSIT,
  });
  if (!deposit.applied) await fail(`deposit failed: ${deposit.reason}`);

  const engagement = await createEngagement({
    taskId: TASK_ID,
    hirerCommitment: OPERATOR_COMMITMENT,
    workerCommitment: WORKER_COMMITMENT,
    amount: ESCROW,
  });
  if (engagement.status !== "HELD") await fail(`unexpected engagement status ${engagement.status}`);

  const payout = await releaseEscrowToWorker(
    OPERATOR_COMMITMENT,
    WORKER_COMMITMENT,
    ESCROW,
    JSON.stringify({ task_id: TASK_ID, phase: "smoke_accept" })
  );
  if (!payout) await fail("escrow release returned no payout");

  const burn = await requestWithdrawal({
    subjectCommitment: WORKER_COMMITMENT,
    operatorId: operator.id,
    amount: BURN,
    reference: WITHDRAW_REF,
    operatorKycStatus: "NOT_REQUIRED",
  });
  if (!burn.applied) await fail(`withdrawal failed: ${burn.reason}`);
  const proofId = proofReceiptId({ amount: BURN, reference: WITHDRAW_REF, subjectCommitment: WORKER_COMMITMENT });

  // Over-withdrawal MUST be refused by the reserve guard.
  const over = await requestWithdrawal({
    subjectCommitment: WORKER_COMMITMENT,
    operatorId: operator.id,
    amount: DEPOSIT,
    reference: "smoke_wd_over",
    operatorKycStatus: "NOT_REQUIRED",
  });

  // Compliance smoke: geofence + KYC predicates are wired.
  const complianceOk =
    shouldBlockWithdrawal("0xbeef", { countryCode: "CU" }) === true &&
    shouldBlockWithdrawal("0xok", { countryCode: "US" }) === false &&
    kycGateForWithdraw("APPROVED") === true;

  // ---------- Snapshot + invariants ----------
  const snapshot: ClosedLoopSnapshot = {
    operatorCommitment: OPERATOR_COMMITMENT,
    workerCommitment: WORKER_COMMITMENT,
    depositAmount: DEPOSIT,
    escrowAmount: ESCROW,
    burnAmount: BURN,
    withdrawReference: WITHDRAW_REF,
    proofId,
    hirer: await loadBalances(OPERATOR_COMMITMENT),
    worker: await loadBalances(WORKER_COMMITMENT),
    overWithdrawRejected: !over.applied,
  };

  const violations = assertClosedLoopInvariants(snapshot);
  if (!complianceOk) violations.push("compliance guard predicates did not behave as expected");

  console.log("• ledger snapshot:", JSON.stringify(snapshotToGolden(snapshot), null, 2));
  if (violations.length > 0) {
    for (const v of violations) console.error(`   - ${v}`);
    await fail("closed-loop invariants violated");
  }

  // ---------- Golden snapshot ----------
  const golden = snapshotToGolden(snapshot);
  if (args.writeGolden) {
    mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
    writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf8");
    console.log(`• golden snapshot written → ${GOLDEN_PATH}`);
  } else if (readFileSafe(GOLDEN_PATH)) {
    const expected = JSON.parse(readFileSafe(GOLDEN_PATH)!);
    const actualStr = JSON.stringify(golden);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
      console.error("• golden mismatch");
      console.error("  expected:", expectedStr);
      console.error("  actual:  ", actualStr);
      await fail("golden snapshot drift detected");
    }
    console.log("• golden snapshot matches ✓");
  }

  console.log("\n✓ closed-loop settlement smoke passed");
  if (args.expectFail) await fail("--expect-fail: harness expected a failure but passed");
  process.exit(0);
}

function readFileSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});