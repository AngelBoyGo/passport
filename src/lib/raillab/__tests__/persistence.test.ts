/**
 * Proof of Persistence tests (Phase 28).
 *
 * Covers the pure cores (ISO weeks, cohorts/retention, funnel, inflation) against synthetic
 * operator timelines, plus the mocked-prisma integration (SETTLED-only rule, signed snapshot
 * after the new block, degraded mode).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agent: { findMany: vi.fn() },
    agentEvidence: { findMany: vi.fn() },
    receipt: { findMany: vi.fn() },
    railSettlement: { findMany: vi.fn() },
    railSpec: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  computePersistence,
  computeFunnel,
  detectInflation,
  fetchPersistenceRows,
  isoWeekKey,
  weekStartMs,
  INFLATION_MIN_COHORT_SIZE,
  INFLATION_MIN_SAMPLE,
  type PersistenceRowSets,
} from "../persistence";
import { buildLighthouse, lighthouseCacheControl } from "../lighthouse";
import { canonicalJson, sha256Hex } from "../../receipt/canonical";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;
const NOW_WEEK = weekStartMs(NOW);
const COHORT = NOW_WEEK - 2 * WEEK; // two ISO weeks ago (so w1/w2 have elapsed)

function emptyRows(): PersistenceRowSets {
  return { agents: [], evidence: [], receipts: [], settlements: [], rails: [] };
}

function agentRow(at: number, operatorId: string, agentId: string, organic = true) {
  return { at, organic, operatorId, agentId };
}
function evidenceRow(at: number, agentIdentityCommitment: string, organic = true) {
  return { at, organic, agentIdentityCommitment };
}
function receiptRow(at: number, operatorId: string, organic = true) {
  return { at, organic, operatorId };
}
function settlementRow(at: number, railKey: string, organic = true) {
  return { at, organic, railKey };
}
function railRow(railKey: string, authorizedBy: string, organic = true, at = COHORT) {
  return { at, organic, railKey, authorizedBy };
}

describe("Proof of Persistence (Phase 28)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(prismaMock)) model.findMany.mockResolvedValue([]);
  });

  describe("ISO week helpers (a)", () => {
    it("weekStartMs returns Monday 00:00 UTC and isoWeekKey is well-formed", () => {
      const ws = weekStartMs(NOW);
      const d = new Date(ws);
      expect(d.getUTCDay()).toBe(1); // Monday
      expect(d.getUTCHours()).toBe(0);
      expect(isoWeekKey(new Date(ws))).toMatch(/^\d{4}-W\d{2}$/);
      // all 7 days of a week share the same key; the next week differs
      expect(isoWeekKey(new Date(ws + 6 * DAY))).toBe(isoWeekKey(new Date(ws)));
      expect(isoWeekKey(new Date(ws + 7 * DAY))).not.toBe(isoWeekKey(new Date(ws)));
    });
  });

  describe("cohorts + retention (b)", () => {
    it("buckets operators by first-seen week and computes w1/w2/w3 retention", () => {
      const rows = emptyRows();
      // Two operators enrolled in the same cohort week; only one returns in week +1.
      rows.agents = [
        agentRow(COHORT + 3600_000, "opA", "a1"),
        agentRow(COHORT + 2 * 3600_000, "opB", "b1"),
      ];
      rows.evidence = [evidenceRow(COHORT + WEEK + 3600_000, "a1")];

      const cohorts = computePersistence(rows, NOW);
      const c = cohorts.find((x) => x.week === isoWeekKey(new Date(COHORT)));
      expect(c).toBeDefined();
      expect(c!.size).toBe(2);
      expect(c!.w1_retention).toBe(0.5);
      expect(c!.w2_retention).toBe(0);
      expect(c!.w3_retention).toBe(0);
    });

    it("returns a full trailing window of cohorts with zero-size weeks present", () => {
      const cohorts = computePersistence(emptyRows(), NOW);
      expect(cohorts.length).toBe(8);
      expect(cohorts[cohorts.length - 1]!.week).toBe(isoWeekKey(NOW));
      expect(cohorts.every((c) => c.size === 0 && c.w1_retention === 0)).toBe(true);
    });

    it("marks the current and previous cohorts immature; older cohorts mature", () => {
      const cohorts = computePersistence(emptyRows(), NOW);
      // last two entries are the current and the immediately preceding ISO week
      expect(cohorts[cohorts.length - 1]!.mature).toBe(false);
      expect(cohorts[cohorts.length - 2]!.mature).toBe(false);
      // everything two or more weeks old has a fully-elapsed w1 window
      expect(cohorts.slice(0, cohorts.length - 2).every((c) => c.mature)).toBe(true);
    });
  });

  describe("conversion funnel (c)", () => {
    it("dedups by operator and is monotonic non-increasing", () => {
      const rows = emptyRows();
      rows.agents = [
        agentRow(COHORT, "opA", "a1"),
        agentRow(COHORT, "opB", "b1"), // never evidences
      ];
      rows.evidence = [
        evidenceRow(COHORT, "a1"),
        evidenceRow(COHORT + WEEK, "a1"), // later-week activity → returned
      ];
      rows.receipts = [receiptRow(COHORT, "opA")];
      rows.rails = [railRow("rail-a", "opA")];
      rows.settlements = [settlementRow(COHORT, "rail-a")];

      const f = computeFunnel(rows, NOW, 30 * DAY);
      expect(f).toEqual({ enrolled: 2, evidenced: 1, receipted: 1, settled: 1, returned: 1 });
      expect(f.enrolled).toBeGreaterThanOrEqual(f.evidenced);
      expect(f.evidenced).toBeGreaterThanOrEqual(f.receipted);
      expect(f.receipted).toBeGreaterThanOrEqual(f.settled);
      expect(f.settled).toBeGreaterThanOrEqual(f.returned);
    });

    it("drops operators whose evidence/settlement cannot be attributed", () => {
      const rows = emptyRows();
      // evidence references an agent we never saw → unattributable
      rows.agents = [agentRow(COHORT, "opA", "a1")];
      rows.evidence = [evidenceRow(COHORT, "ghost-agent")];
      const f = computeFunnel(rows, NOW, 30 * DAY);
      expect(f.enrolled).toBe(1);
      expect(f.evidenced).toBe(0);
    });
  });

  describe("inflation detection (d)", () => {
    function enrollMany(n: number, at: number, withLaterActivity: boolean): PersistenceRowSets {
      const rows = emptyRows();
      for (let i = 0; i < n; i++) {
        rows.agents.push(agentRow(at, `op${i}`, `a${i}`));
      }
      if (withLaterActivity) {
        for (let i = 0; i < n; i++) {
          rows.evidence.push(evidenceRow(at + WEEK + 3600_000, `a${i}`));
        }
      }
      return rows;
    }

    it("flags an enroll-and-vanish cohort (size >= min, w1 retention < 10%)", () => {
      const rows = enrollMany(INFLATION_MIN_COHORT_SIZE, COHORT, false);
      const report = detectInflation(rows, NOW);
      expect(report.suspicious).toBe(true);
      expect(report.reasons.join(" ")).toContain("enroll-and-vanish");
    });

    it("does NOT flag a healthy returning cohort", () => {
      const rows = enrollMany(INFLATION_MIN_COHORT_SIZE, COHORT, true);
      const report = detectInflation(rows, NOW);
      expect(report.suspicious).toBe(false);
      expect(report.reasons).toEqual([]);
    });

    it("does NOT flag an immature (current-week) cohort even at size, because w1 has not elapsed", () => {
      // 10 operators enrolled THIS week, each already settled (so the never-settled check is
      // silenced). Their w1 window is in the future, so they must not be labelled vanish.
      const rows = emptyRows();
      const nowMs = NOW.getTime();
      for (let i = 0; i < INFLATION_MIN_COHORT_SIZE; i++) {
        rows.agents.push(agentRow(nowMs - 3600_000, `op${i}`, `a${i}`));
        rows.rails.push(railRow(`rail-${i}`, `op${i}`, true, nowMs - 3600_000));
        rows.settlements.push(settlementRow(nowMs - 1800_000, `rail-${i}`));
      }
      const report = detectInflation(rows, NOW);
      expect(report.reasons.join(" ")).not.toContain("enroll-and-vanish");
      expect(report.suspicious).toBe(false);
    });

    it("flags a never-settled ratio over 7d once the sample is large enough", () => {
      const rows = emptyRows();
      // 10 operators first seen 4 days ago (past the 3-day grace) who never settled.
      for (let i = 0; i < INFLATION_MIN_SAMPLE; i++) {
        rows.agents.push(agentRow(NOW.getTime() - 4 * DAY, `new${i}`, `na${i}`));
      }
      const report = detectInflation(rows, NOW);
      expect(report.suspicious).toBe(true);
      expect(report.reasons.join(" ")).toContain("never-settled");
    });

    it("does NOT flag fresh enrollments still inside the settlement grace period", () => {
      const rows = emptyRows();
      // Same count, but enrolled < 3 days ago → not yet expected to have settled.
      for (let i = 0; i < INFLATION_MIN_SAMPLE; i++) {
        rows.agents.push(agentRow(NOW.getTime() - 12 * 3600_000, `fresh${i}`, `fa${i}`));
      }
      const report = detectInflation(rows, NOW);
      expect(report.reasons.join(" ")).not.toContain("never-settled");
      expect(report.suspicious).toBe(false);
    });
  });

  describe("integration: SETTLED-only, snapshot, degraded (e)", () => {
    it("counts only SETTLED settlements (a REJECTED spam row is not organic)", async () => {
      prismaMock.railSettlement.findMany.mockResolvedValue([
        { createdAt: new Date(NOW), railKey: "rail-real", reference: "r1", status: "SETTLED" },
        { createdAt: new Date(NOW), railKey: "rail-real", reference: "r2-spam", status: "REJECTED" },
      ]);
      const rows = await fetchPersistenceRows([]);
      expect(rows.settlements).toHaveLength(2);
      expect(rows.settlements[0]!.organic).toBe(true);
      expect(rows.settlements[1]!.organic).toBe(false);
    });

    it("snapshot still verifies after the persistence block is added", async () => {
      const res = await buildLighthouse(NOW);
      const { snapshot, ...signed } = res;
      const recomputed = sha256Hex(canonicalJson(signed as unknown as Record<string, unknown>));
      expect(recomputed).toBe(snapshot.content_hash);
      const valid = verify(
        hexToBytes(snapshot.signature),
        utf8ToBytes(recomputed),
        hexToBytes(snapshot.public_key)
      );
      expect(valid).toBe(true);
      expect(res.lighthouse.persistence).toBeDefined();
      expect(res.lighthouse.persistence.funnel.all).toBeDefined();
    });

    it("degrades to 200-shaped output with reasons when a table fails", async () => {
      prismaMock.agent.findMany.mockRejectedValue(new Error("db down"));
      const res = await buildLighthouse(NOW);
      expect(res.success).toBe(true);
      expect(res.lighthouse.degraded).toBe(true);
      expect(res.lighthouse.degraded_reasons.join(" ")).toContain("agent: db down");
    });

    it("does not cache a suspicious reading", () => {
      expect(lighthouseCacheControl(false, false)).toBe("private, max-age=300");
      expect(lighthouseCacheControl(false, true)).toBe("private, no-store, max-age=0");
      expect(lighthouseCacheControl(true, false)).toBe("private, no-store, max-age=0");
    });
  });
});
