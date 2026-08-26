import { describe, it, expect } from "vitest";
import {
  assertClosedLoopInvariants,
  parseClosedLoopArgs,
  snapshotToGolden,
  type ClosedLoopSnapshot,
} from "@/lib/release/angelcoin-closed-loop";

// Recorded golden fixture from a real run of the closed-loop harness
// (deposit 1000; escrow 500; worker burn 500).
function fixtureSnapshot(): ClosedLoopSnapshot {
  return {
    operatorCommitment: "h".repeat(64),
    workerCommitment: "w".repeat(64),
    depositAmount: 1000,
    escrowAmount: 500,
    burnAmount: 500,
    withdrawReference: "smoke_wd_1",
    proofId: "a".repeat(64),
    hirer: { granted: 1000, earned: 0, spent: 500, locked: 0, available: 500 },
    worker: { granted: 0, earned: 500, spent: 500, locked: 0, available: 0 },
    overWithdrawRejected: true,
  };
}

describe("AngelCoin closed-loop invariants (pure)", () => {
  it("accepts a sound closed-loop snapshot", () => {
    expect(assertClosedLoopInvariants(fixtureSnapshot())).toEqual([]);
  });

  it("fails when deposit != minted", () => {
    const s = fixtureSnapshot();
    s.hirer = { granted: 900, earned: 0, spent: 500, locked: 0, available: 400 };
    expect(assertClosedLoopInvariants(s)).toContain("deposit 1000 != minted 900");
  });

  it("fails when worker can burn beyond the reserve (unguarded)", () => {
    const s = fixtureSnapshot();
    s.worker = { granted: 0, earned: 500, spent: 1000, locked: 0, available: -500 };
    expect(assertClosedLoopInvariants(s)).toContain("worker burn/spend 1000 != burn 500");
  });

  it("fails when over-withdrawal was NOT rejected", () => {
    const s = fixtureSnapshot();
    s.overWithdrawRejected = false;
    expect(assertClosedLoopInvariants(s).join(" ")).toContain("over-withdrawal was not rejected");
  });

  it("produces a deterministic golden projection (no internal ids)", () => {
    const golden = snapshotToGolden(fixtureSnapshot());
    expect(golden.proofId).toBe("a".repeat(64));
    expect(golden.hirerBalances.available).toBe(500);
    // commitments are deterministic inputs, amounts are stable
    expect(golden.depositAmount).toBe(1000);
    expect(golden).not.toHaveProperty("operatorId");
    expect(JSON.stringify(snapshotToGolden(fixtureSnapshot()))).toBe(
      JSON.stringify(golden)
    );
  });

  it("parses harness flags", () => {
    expect(parseClosedLoopArgs(["--reset", "--write-golden"])).toMatchObject({
      reset: true,
      writeGolden: true,
      expectFail: false,
    });
    expect(parseClosedLoopArgs(["--expect-fail"])).toMatchObject({ expectFail: true });
    expect(parseClosedLoopArgs(["-h"])).toMatchObject({ help: true });
  });
});