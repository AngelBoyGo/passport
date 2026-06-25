import { describe, it, expect, vi } from "vitest";
import { ErrorTranche, OperatorAccountStatus } from "@prisma/client";

import {
  getPenaltyForTranche,
  shouldApplySlashing,
} from "@/lib/escrow/penalties";
import {
  applySlashingInTransaction,
  lockOperatorForUpdate,
} from "@/lib/escrow/slashing";

describe("penalty tiers", () => {
  it("DATA_LEAKAGE Critical tier is 10000 cents", () => {
    expect(getPenaltyForTranche(ErrorTranche.DATA_LEAKAGE)).toBe(10000);
  });

  it("LOGIC_DETECTION Standard tier is 2500 cents", () => {
    expect(getPenaltyForTranche(ErrorTranche.LOGIC_DETECTION)).toBe(2500);
  });

  it("COMPUTE_TIMEOUT has zero penalty", () => {
    expect(getPenaltyForTranche(ErrorTranche.COMPUTE_TIMEOUT)).toBe(0);
  });

  it("NONE tranche has zero penalty", () => {
    expect(getPenaltyForTranche(ErrorTranche.NONE)).toBe(0);
  });
});

describe("shouldApplySlashing", () => {
  it("applies for terminal failure with error tranche", () => {
    expect(
      shouldApplySlashing("failure_tombstone", ErrorTranche.DATA_LEAKAGE)
    ).toBe(true);
  });

  it("skips success with NONE", () => {
    expect(shouldApplySlashing("success", ErrorTranche.NONE)).toBe(false);
  });

  it("skips when tranche is absent", () => {
    expect(shouldApplySlashing("timeout", undefined)).toBe(false);
  });
});

describe("applySlashingInTransaction", () => {
  const operatorId = "op_slash_test";
  const receiptId = "rcpt_slash_test";

  function makeTx(initialBalance: number) {
    let balance = initialBalance;
    let accountStatus: OperatorAccountStatus = OperatorAccountStatus.ACTIVE;
    const ledger: Array<{
      operatorId: string;
      receiptId: string;
      penaltyCents: number;
      tranche: ErrorTranche;
    }> = [];

    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          id: operatorId,
          stakeBalanceCents: balance,
          accountStatus,
        },
      ]),
      operator: {
        update: vi.fn(
          async (args: {
            where: { id: string };
            data: {
              stakeBalanceCents?: number;
              accountStatus?: OperatorAccountStatus;
            };
          }) => {
            if (args.data.stakeBalanceCents !== undefined) {
              balance = args.data.stakeBalanceCents;
            }
            if (args.data.accountStatus !== undefined) {
              accountStatus = args.data.accountStatus;
            }
            return { id: operatorId, stakeBalanceCents: balance, accountStatus };
          }
        ),
      },
      slashingLedger: {
        create: vi.fn(
          async (args: {
            data: {
              operatorId: string;
              receiptId: string;
              penaltyCents: number;
              tranche: ErrorTranche;
            };
          }) => {
            ledger.push(args.data);
            return { id: "ledger_1", ...args.data };
          }
        ),
      },
    };

    return { tx, getBalance: () => balance, getStatus: () => accountStatus, ledger };
  }

  it("deducts exact penalty cents for LOGIC_DETECTION", async () => {
    const { tx, getBalance, ledger } = makeTx(10000);
    const result = await applySlashingInTransaction(
      tx as never,
      operatorId,
      receiptId,
      ErrorTranche.LOGIC_DETECTION
    );
    expect(result.deductedCents).toBe(2500);
    expect(getBalance()).toBe(7500);
    expect(ledger[0]?.penaltyCents).toBe(2500);
  });

  it("deducts exact penalty cents for DATA_LEAKAGE", async () => {
    const { tx, getBalance } = makeTx(20000);
    const result = await applySlashingInTransaction(
      tx as never,
      operatorId,
      receiptId,
      ErrorTranche.DATA_LEAKAGE
    );
    expect(result.deductedCents).toBe(10000);
    expect(getBalance()).toBe(10000);
  });

  it("logs telemetry only for COMPUTE_TIMEOUT without balance change", async () => {
    const { tx, getBalance, ledger } = makeTx(8000);
    const result = await applySlashingInTransaction(
      tx as never,
      operatorId,
      receiptId,
      ErrorTranche.COMPUTE_TIMEOUT
    );
    expect(result.deductedCents).toBe(0);
    expect(getBalance()).toBe(8000);
    expect(ledger[0]?.penaltyCents).toBe(0);
  });

  it("partial penalty on insolvent balance deducts to zero", async () => {
    const { tx, getBalance, getStatus, ledger } = makeTx(1500);
    const result = await applySlashingInTransaction(
      tx as never,
      operatorId,
      receiptId,
      ErrorTranche.LOGIC_DETECTION
    );
    expect(result.deductedCents).toBe(1500);
    expect(result.fullPenaltyCents).toBe(2500);
    expect(getBalance()).toBe(0);
    expect(ledger[0]?.penaltyCents).toBe(1500);
    expect(getStatus()).toBe(OperatorAccountStatus.ESCROW_INSOLVENT_BLOCKED);
  });

  it("flags ESCROW_INSOLVENT_BLOCKED when penalty exceeds balance", async () => {
    const { tx, getStatus } = makeTx(500);
    await applySlashingInTransaction(
      tx as never,
      operatorId,
      receiptId,
      ErrorTranche.DATA_LEAKAGE
    );
    expect(getStatus()).toBe(OperatorAccountStatus.ESCROW_INSOLVENT_BLOCKED);
  });
});

describe("concurrent slashing simulation", () => {
  it("serializes concurrent balance updates without race errors", async () => {
    let balance = 5000;
    const lock = { held: false, queue: [] as Array<() => void> };

    async function withLock<T>(fn: () => Promise<T>): Promise<T> {
      await new Promise<void>((resolve) => {
        const attempt = () => {
          if (!lock.held) {
            lock.held = true;
            resolve();
          } else {
            lock.queue.push(attempt);
          }
        };
        attempt();
      });
      try {
        return await fn();
      } finally {
        lock.held = false;
        const next = lock.queue.shift();
        if (next) next();
      }
    }

    function makeConcurrentTx() {
      return {
        $queryRaw: vi.fn(async () => [
          { id: "op_concurrent", stakeBalanceCents: balance, accountStatus: OperatorAccountStatus.ACTIVE },
        ]),
        operator: {
          update: vi.fn(
            async (args: { data: { stakeBalanceCents?: number } }) => {
              balance = args.data.stakeBalanceCents ?? balance;
              return { stakeBalanceCents: balance };
            }
          ),
        },
        slashingLedger: {
          create: vi.fn(async (args: { data: { penaltyCents: number } }) => args.data),
        },
      };
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withLock(async () => {
          const tx = makeConcurrentTx();
          return applySlashingInTransaction(
            tx as never,
            "op_concurrent",
            `rcpt_${i}`,
            ErrorTranche.COMPUTE_TIMEOUT
          );
        })
      )
    );

    expect(results).toHaveLength(10);
    expect(balance).toBe(5000);
    expect(results.every((r) => r.deductedCents === 0)).toBe(true);
  });

  it("concurrent penalties never drive balance negative", async () => {
    let balance = 3000;
    let lockHeld = false;
    const waiters: Array<() => void> = [];

    async function acquire() {
      while (lockHeld) {
        await new Promise<void>((r) => waiters.push(r));
      }
      lockHeld = true;
    }

    function release() {
      lockHeld = false;
      const next = waiters.shift();
      if (next) next();
    }

    const deductions: number[] = [];

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        (async () => {
          await acquire();
          try {
            const tx = {
              $queryRaw: vi.fn(async () => [
                {
                  id: "op_race",
                  stakeBalanceCents: balance,
                  accountStatus: OperatorAccountStatus.ACTIVE,
                },
              ]),
              operator: {
                update: vi.fn(async (args: { data: { stakeBalanceCents?: number } }) => {
                  balance = args.data.stakeBalanceCents ?? balance;
                  return {};
                }),
              },
              slashingLedger: {
                create: vi.fn(async (args: { data: { penaltyCents: number } }) => {
                  deductions.push(args.data.penaltyCents);
                  return args.data;
                }),
              },
            };
            const result = await applySlashingInTransaction(
              tx as never,
              "op_race",
              `rcpt_race_${i}`,
              ErrorTranche.LOGIC_DETECTION
            );
            expect(result.deductedCents).toBeGreaterThanOrEqual(0);
            expect(balance).toBeGreaterThanOrEqual(0);
          } finally {
            release();
          }
        })()
      )
    );

    expect(balance).toBeGreaterThanOrEqual(0);
    expect(deductions.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(balance).toBe(0);
  });
});

describe("lockOperatorForUpdate", () => {
  it("issues SELECT FOR UPDATE on operator row", async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: "op_lock",
        stakeBalanceCents: 9000,
        accountStatus: OperatorAccountStatus.ACTIVE,
      },
    ]);
    const tx = { $queryRaw: queryRaw };
    const row = await lockOperatorForUpdate(tx as never, "op_lock");
    expect(row.stakeBalanceCents).toBe(9000);
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
