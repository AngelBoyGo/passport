/**
 * AngelCoin closed-loop settlement — pure, DB-free helpers.
 *
 * The smoke harness drives the REAL ledger services and produces a
 * ClosedLoopSnapshot. These functions validate the invariant ledger and produce
 * a deterministic golden object so CI can catch drift without a database.
 */

export type ClosedLoopBalances = {
  granted: number;
  earned: number;
  spent: number;
  locked: number;
  available: number;
};

export type ClosedLoopSnapshot = {
  operatorCommitment: string;
  workerCommitment: string;
  depositAmount: number;
  escrowAmount: number;
  burnAmount: number;
  withdrawReference: string;
  proofId: string;
  hirer: ClosedLoopBalances;
  worker: ClosedLoopBalances;
  overWithdrawRejected: boolean;
};

/**
 * Validates the closed-loop invariant ledger. Returns a list of violated
 * messages (empty when sound). Throws nothing; callers decide how to exit.
 */
export function assertClosedLoopInvariants(
  s: ClosedLoopSnapshot
): string[] {
  const violations: string[] = [];

  // Per-account books must balance (granted + earned - spent - locked = available).
  for (const [label, b] of [
    ["hirer", s.hirer],
    ["worker", s.worker],
  ] as const) {
    const computed = b.granted + b.earned - b.spent - b.locked;
    if (computed !== b.available) {
      violations.push(`${label}: books imbalance (${computed} != ${b.available})`);
    }
  }

  // Deposit equals minted credits.
  if (s.hirer.granted !== s.depositAmount) {
    violations.push(`deposit ${s.depositAmount} != minted ${s.hirer.granted}`);
  }

  // Escrow: hirer spent what was locked; worker earned the escrow amount.
  if (s.hirer.spent !== s.escrowAmount) {
    violations.push(`escrow spend ${s.hirer.spent} != escrow ${s.escrowAmount}`);
  }
  if (s.worker.earned !== s.escrowAmount) {
    violations.push(`worker earned ${s.worker.earned} != escrow ${s.escrowAmount}`);
  }

  // Burn reduces worker's available exactly; worker spent equals burn.
  if (s.worker.spent !== s.burnAmount) {
    violations.push(`worker burn/spend ${s.worker.spent} != burn ${s.burnAmount}`);
  }
  if (s.worker.available !== s.escrowAmount - s.burnAmount) {
    violations.push(
      `worker available ${s.worker.available} != escrow-burn ${s.escrowAmount - s.burnAmount}`
    );
  }

  // Hirer available after escrow (deposit - escrow).
  if (s.hirer.available !== s.depositAmount - s.escrowAmount) {
    violations.push(
      `hirer available ${s.hirer.available} != deposit-escrow ${s.depositAmount - s.escrowAmount}`
    );
  }

  // Reserve guard: over-withdrawal must have been refused.
  if (!s.overWithdrawRejected) {
    violations.push("over-withdrawal was not rejected by the reserve guard");
  }

  // Proof id must be present and hex.
  if (!/^[0-9a-f]{64}$/i.test(s.proofId)) {
    violations.push("proofId is not a 64-hex value");
  }

  return violations;
}

export type ClosedLoopGolden = {
  operatorCommitment: string;
  workerCommitment: string;
  depositAmount: number;
  escrowAmount: number;
  burnAmount: number;
  withdrawReference: string;
  proofId: string;
  overWithdrawRejected: boolean;
  hirerBalances: ClosedLoopBalances;
  workerBalances: ClosedLoopBalances;
};

/**
 * Produces a deterministic, golden-serializable projection of the snapshot.
 * Excludes operator/internal ids — only commitment-derived and amount data —
 * so it is stable across runs on the same logical ledger.
 */
export function snapshotToGolden(s: ClosedLoopSnapshot): ClosedLoopGolden {
  return {
    operatorCommitment: s.operatorCommitment,
    workerCommitment: s.workerCommitment,
    depositAmount: s.depositAmount,
    escrowAmount: s.escrowAmount,
    burnAmount: s.burnAmount,
    withdrawReference: s.withdrawReference,
    proofId: s.proofId,
    overWithdrawRejected: s.overWithdrawRejected,
    hirerBalances: s.hirer,
    workerBalances: s.worker,
  };
}

export function parseClosedLoopArgs(
  argv: string[]
): { reset: boolean; expectFail: boolean; writeGolden: boolean; help: boolean } {
  return {
    reset: argv.includes("--reset"),
    expectFail: argv.includes("--expect-fail"),
    writeGolden: argv.includes("--write-golden"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

export const CLOSED_LOOP_SMOKE_ALLOW = "PASSPORT_SMOKE_ALLOW";
export const CLOSED_LOOP_GUARD = "closed-loop smoke requires NODE_ENV!=production and PASSPORT_SMOKE_ALLOW=1";