import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertRwaClosedLoopInvariants,
  snapshotToRwaGolden,
  parseRwaSmokeArgs,
  type RwaClosedLoopSnapshot,
} from "../rwa-closed-loop";

function fixtureSnapshot(): RwaClosedLoopSnapshot {
  return {
    escrowId: "esc_smoke_rwa_001",
    buyerCommitment: "a".repeat(64),
    sellerCommitment: "b".repeat(64),
    batchNumber: "BKO-AU-2026-SMOKE",
    fineGrams: 100.0,
    unitPriceUsd: 75.0,
    lockedAngel: 1000,
    protocolFeeAngel: 25,
    sellerPayoutAngel: 975,
    buyerInitialBalance: 2000,
    buyerFinalBalance: 1000,
    sellerInitialBalance: 500,
    sellerFinalBalance: 1475,
    escrowStatus: "RELEASED",
    batchInitialStatus: "AUDITED",
    batchFinalStatus: "SETTLED_DELIVERY",
    assayCertificationNumber: "ASSAY-BKO-2026-SMOKE",
    merkleRootPreSettlement: "c".repeat(64),
    disbursement: {
      totalFee: 25,
      national: 6,
      community: 3,
      workers: 2,
      treasury: 7,
      validators: 5,
      agentRebate: 2,
    },
  };
}

describe("RWA Closed-Loop Invariant Engine (Pure)", () => {
  it("accepts a completely sound RWA clearing snapshot", () => {
    const violations = assertRwaClosedLoopInvariants(fixtureSnapshot());
    expect(violations).toEqual([]);
  });

  it("detects collateral conservation violation (stolen funds or mismatch)", () => {
    const s = fixtureSnapshot();
    s.sellerPayoutAngel = 900; // 900 + 25 = 925 != 1000 locked
    const violations = assertRwaClosedLoopInvariants(s);
    expect(violations.some((v) => v.includes("Collateral conservation broken"))).toBe(true);
  });

  it("detects buyer balance delta discrepancy", () => {
    const s = fixtureSnapshot();
    s.buyerFinalBalance = 1500; // delta = 500 != 1000 locked
    const violations = assertRwaClosedLoopInvariants(s);
    expect(violations.some((v) => v.includes("Buyer balance decrement"))).toBe(true);
  });

  it("detects seller balance delta discrepancy", () => {
    const s = fixtureSnapshot();
    s.sellerFinalBalance = 1000; // delta = 500 != 975 payout
    const violations = assertRwaClosedLoopInvariants(s);
    expect(violations.some((v) => v.includes("Seller balance increment"))).toBe(true);
  });

  it("detects unreleased escrow or unsettled lot status", () => {
    const s1 = fixtureSnapshot();
    s1.escrowStatus = "HELD";
    expect(assertRwaClosedLoopInvariants(s1).some((v) => v.includes("escrowStatus"))).toBe(true);

    const s2 = fixtureSnapshot();
    s2.batchFinalStatus = "AUDITED" as unknown as "SETTLED_DELIVERY";
    expect(assertRwaClosedLoopInvariants(s2).some((v) => v.includes("batchFinalStatus"))).toBe(true);
  });

  it("detects protocol fee mismatch against 250 bps statutory rate", () => {
    const s = fixtureSnapshot();
    s.protocolFeeAngel = 50; // 50 != 25 (2.5%)
    s.sellerPayoutAngel = 950;
    const violations = assertRwaClosedLoopInvariants(s);
    expect(violations.some((v) => v.includes("Protocol fee mismatch"))).toBe(true);
  });

  it("detects sovereign dividend waterfall mismatches", () => {
    const s1 = fixtureSnapshot();
    s1.disbursement!.totalFee = 50; // doesn't match protocol fee 25
    expect(
      assertRwaClosedLoopInvariants(s1).some((v) =>
        v.includes("Disbursement total fee")
      )
    ).toBe(true);

    const s2 = fixtureSnapshot();
    s2.disbursement!.national = 0; // sum 0+3+2+7+5+2 = 19 != 25
    expect(
      assertRwaClosedLoopInvariants(s2).some((v) =>
        v.includes("Disbursement waterfall sum")
      )
    ).toBe(true);
  });

  it("validates 64-hex commitment and root formats", () => {
    const s = fixtureSnapshot();
    s.buyerCommitment = "invalid-hex";
    expect(assertRwaClosedLoopInvariants(s).some((v) => v.includes("buyerCommitment"))).toBe(true);

    const s2 = fixtureSnapshot();
    s2.merkleRootPreSettlement = "short-root";
    expect(assertRwaClosedLoopInvariants(s2).some((v) => v.includes("merkleRootPreSettlement"))).toBe(true);
  });

  it("matches the committed deterministic golden fixture", () => {
    const snapshot = fixtureSnapshot();
    const golden = snapshotToRwaGolden(snapshot);

    const goldenPath = path.resolve(
      __dirname,
      "../../../../scripts/fixtures/rwa-closed-loop.golden.json"
    );
    const committedRaw = fs.readFileSync(goldenPath, "utf8");
    const committedGolden = JSON.parse(committedRaw);

    expect(golden).toEqual(committedGolden);
  });

  it("parses CLI arguments for smoke harness", () => {
    const args1 = parseRwaSmokeArgs(["--write-golden", "--dry-run"]);
    expect(args1.writeGolden).toBe(true);
    expect(args1.dryRun).toBe(true);
    expect(args1.help).toBe(false);

    const args2 = parseRwaSmokeArgs(["-h"]);
    expect(args2.help).toBe(true);
  });
});
