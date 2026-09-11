/**
 * Adoption Lighthouse tests (Phase 27).
 *
 * The aggregation is split into a pure core (`computeLighthouse` over fetched rows) and a
 * thin DB/I/O shell (`buildLighthouse`). These tests cover:
 *   1. organic-vs-self filter — `adopt-*` / `smoke:` markers excluded, real rows counted;
 *   2. window buckets math (24h / 7d / 30d / all on fixed timestamps);
 *   3. trend directions (growing / flat / falling) via two-window deltas;
 *   4. degraded mode — a failing table returns the rest with `degraded:true` + reason;
 *   5. signed snapshot — recompute canonicalJson(body without snapshot) + verify Ed25519;
 *   6. operator prefix masking — no raw operator id leaves the server.
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
  buildLighthouse,
  classifyTrend,
  computeLighthouse,
  hasOrganicMarker,
  isOrganicRow,
  lighthouseCacheControl,
  maskOperatorPrefix,
  LIGHTHOUSE_MARKERS,
  LIGHTHOUSE_MAX_SCAN,
  type LighthouseRowSets,
} from "../lighthouse";
import { canonicalJson, sha256Hex } from "../../receipt/canonical";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const HOUR = 3600_000;

function mkRow(atMs: number, organic: boolean, operatorId?: string) {
  return { at: atMs, organic, operatorId };
}

function emptyRows(): LighthouseRowSets {
  return { agents: [], evidence: [], receipts: [], settlements: [], rails: [] };
}

const RAW_OPERATOR_ID = "supersecret-operator-id";

describe("Adoption Lighthouse (Phase 27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(prismaMock)) {
      model.findMany.mockResolvedValue([]);
    }
  });

  describe("organic filter (a)", () => {
    it("detects markers and treats marker-free rows as organic", () => {
      expect(hasOrganicMarker("adopt-20260101")).toBe(true);
      expect(hasOrganicMarker("rail-adopt-canary-abc")).toBe(true);
      expect(hasOrganicMarker("smoke:rwa:buyer")).toBe(true);
      expect(hasOrganicMarker("real-agent-commitment")).toBe(false);
      expect(hasOrganicMarker(null)).toBe(false);
      expect(hasOrganicMarker(42)).toBe(false);

      expect(isOrganicRow([null, "anything", "organic"])).toBe(true);
      expect(isOrganicRow(["ok", "adopt-loop"])).toBe(false);
      expect(LIGHTHOUSE_MARKERS).toEqual(["adopt-", "adopt-canary-", "smoke:"]);
    });

    it("excludes self-generated rows and counts real rows", () => {
      const rows = emptyRows();
      rows.agents = [mkRow(NOW.getTime() - HOUR, true, RAW_OPERATOR_ID)];
      rows.settlements = [
        mkRow(NOW.getTime() - HOUR, false), // adopt-canary rail → excluded by caller
        mkRow(NOW.getTime() - HOUR, true),
      ];
      const metrics = computeLighthouse(rows, NOW);
      expect(metrics.buckets["24h"].enrolled_agents).toBe(1);
      expect(metrics.buckets["24h"].settlements).toBe(1);
      expect(metrics.organic_only).toBe(true);
      expect(metrics.excluded_markers).toEqual(["adopt-", "adopt-canary-", "smoke:"]);
    });
  });

  describe("window buckets (b)", () => {
    it("partitions rows across 24h / 7d / 30d / all by timestamp", () => {
      const rows = emptyRows();
      rows.agents = [
        mkRow(NOW.getTime() - 1 * HOUR, true, "alpha-1"), // 24h+
        mkRow(NOW.getTime() - 3 * 24 * HOUR, true, "beta-2"), // 7d+
        mkRow(NOW.getTime() - 10 * 24 * HOUR, true, "gamma-3"), // 30d+
        mkRow(NOW.getTime() - 40 * 24 * HOUR, true, "delta-4"), // all only
        mkRow(NOW.getTime() - 1 * HOUR, false, "smoke:x"), // excluded everywhere
      ];
      rows.evidence = [
        mkRow(NOW.getTime() - 2 * HOUR, true),
        mkRow(NOW.getTime() - 8 * 24 * HOUR, true),
      ];
      const m = computeLighthouse(rows, NOW);

      expect(m.buckets["24h"].enrolled_agents).toBe(1);
      expect(m.buckets["7d"].enrolled_agents).toBe(2);
      expect(m.buckets["30d"].enrolled_agents).toBe(3);
      expect(m.buckets.all.enrolled_agents).toBe(4);

      expect(m.buckets["24h"].evidence_events).toBe(1);
      expect(m.buckets["7d"].evidence_events).toBe(1);
      expect(m.buckets["30d"].evidence_events).toBe(2);
      expect(m.buckets.all.evidence_events).toBe(2);

      // distinct operator prefixes per window
      expect(m.buckets["24h"].distinct_operator_prefixes).toBe(1);
      expect(m.buckets["7d"].distinct_operator_prefixes).toBe(2);
      expect(m.buckets["30d"].distinct_operator_prefixes).toBe(3);
      expect(m.buckets.all.distinct_operator_prefixes).toBe(4);
    });

    it("counts only ENABLED rails (rows are pre-filtered by the fetcher)", () => {
      const rows = emptyRows();
      rows.rails = [
        mkRow(NOW.getTime() - HOUR, true),
        mkRow(NOW.getTime() - HOUR, true),
      ];
      const m = computeLighthouse(rows, NOW);
      expect(m.buckets["24h"].enabled_rails).toBe(2);
    });
  });

  describe("trend (c)", () => {
    it("classifyTrend: rising → growing, equal → flat, fewer → falling", () => {
      expect(classifyTrend(1, 2)).toBe("growing");
      expect(classifyTrend(2, 2)).toBe("flat");
      expect(classifyTrend(3, 1)).toBe("falling");
    });

    it("computes 24h trend against the equal preceding window", () => {
      // current 24h: 2 rows; preceding 24h: 1 row → growing
      const growing = emptyRows();
      growing.settlements = [
        mkRow(NOW.getTime() - 1 * HOUR, true),
        mkRow(NOW.getTime() - 2 * HOUR, true),
        mkRow(NOW.getTime() - 30 * HOUR, true), // previous window
      ];
      expect(computeLighthouse(growing, NOW).trend["24h"].settlements).toBe("growing");

      // equal → flat
      const flat = emptyRows();
      flat.settlements = [
        mkRow(NOW.getTime() - 1 * HOUR, true),
        mkRow(NOW.getTime() - 30 * HOUR, true),
      ];
      expect(computeLighthouse(flat, NOW).trend["24h"].settlements).toBe("flat");

      // fewer → falling
      const falling = emptyRows();
      falling.settlements = [
        mkRow(NOW.getTime() - 1 * HOUR, true),
        mkRow(NOW.getTime() - 30 * HOUR, true),
        mkRow(NOW.getTime() - 31 * HOUR, true),
      ];
      expect(computeLighthouse(falling, NOW).trend["24h"].settlements).toBe("falling");
    });

    it("computes 7d trend against the preceding week", () => {
      const rows = emptyRows();
      rows.agents = [
        mkRow(NOW.getTime() - 1 * 24 * HOUR, true, "a1"),
        mkRow(NOW.getTime() - 9 * 24 * HOUR, true, "b1"), // previous 7d window
      ];
      const m = computeLighthouse(rows, NOW);
      // current 7d: 1 ; previous 7d: 1 → flat
      expect(m.trend["7d"].enrolled_agents).toBe("flat");
    });
  });

  describe("degraded mode (d)", () => {
    it("returns 200-shaped body with degraded:true and a reason when a table throws", async () => {
      prismaMock.agent.findMany.mockRejectedValue(new Error("db down"));
      prismaMock.railSettlement.findMany.mockResolvedValue([
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "rail-real", reference: "ref-1", status: "SETTLED" },
      ]);

      const res = await buildLighthouse(NOW);
      expect(res.lighthouse.degraded).toBe(true);
      expect(res.lighthouse.degraded_reasons.join(" ")).toContain("agent: db down");
      // the working table was still counted
      expect(res.lighthouse.buckets["24h"].settlements).toBe(1);
      expect(res.success).toBe(true);
    });

    it("is not degraded when every table reads cleanly", async () => {
      const res = await buildLighthouse(NOW);
      expect(res.lighthouse.degraded).toBe(false);
      expect(res.lighthouse.degraded_reasons).toEqual([]);
    });

    it("surfaces a truncation reason when a scan hits the cap", async () => {
      prismaMock.agent.findMany.mockResolvedValue(
        Array.from({ length: LIGHTHOUSE_MAX_SCAN }, () => ({
          createdAt: new Date(NOW.getTime() - HOUR),
          agentId: "org",
          domain: "CODE",
          operatorId: "op-1",
        }))
      );
      const res = await buildLighthouse(NOW);
      expect(res.lighthouse.degraded).toBe(true);
      expect(res.lighthouse.degraded_reasons.join(" ")).toContain("truncated");
    });
  });

  describe("signed snapshot (e)", () => {
    it("signs canonicalJson(body without snapshot) and verifies offline", async () => {
      const res = await buildLighthouse(NOW);
      const { snapshot, ...signed } = res;

      const recomputed = sha256Hex(canonicalJson(signed as unknown as Record<string, unknown>));
      expect(recomputed).toBe(snapshot.content_hash);
      expect(snapshot.algorithm).toBe("ed25519");
      expect(snapshot.public_key).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot.signature).toMatch(/^[0-9a-f]{128}$/);

      const valid = verify(
        hexToBytes(snapshot.signature),
        utf8ToBytes(recomputed),
        hexToBytes(snapshot.public_key)
      );
      expect(valid).toBe(true);

      // tampering the body breaks the hash
      const tampered = { ...signed, lighthouse: { ...signed.lighthouse, degraded: true } };
      const tamperedHash = sha256Hex(canonicalJson(tampered as unknown as Record<string, unknown>));
      expect(tamperedHash).not.toBe(snapshot.content_hash);
    });

    it("fails closed in production when no signing key is configured", async () => {
      const savedKey = process.env.SIGNING_PRIVATE_KEY;
      const savedEnv = process.env.NODE_ENV;
      try {
        delete process.env.SIGNING_PRIVATE_KEY;
        (process.env as Record<string, string | undefined>).NODE_ENV = "production";
        await expect(buildLighthouse(NOW)).rejects.toThrow(/SIGNING_PRIVATE_KEY is required/);
      } finally {
        process.env.SIGNING_PRIVATE_KEY = savedKey;
        (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
      }
    });

    it("cache policy is private and never caches a degraded reading", () => {
      expect(lighthouseCacheControl(false)).toBe("private, max-age=300");
      expect(lighthouseCacheControl(true)).toBe("private, no-store, max-age=0");
    });
  });

  describe("operator privacy (f)", () => {
    it("never emits a raw operator id — only 4-char prefixes", async () => {
      prismaMock.agent.findMany.mockResolvedValue([
        {
          createdAt: new Date(NOW.getTime() - HOUR),
          agentId: "agent-commitment",
          domain: "CODE",
          operatorId: RAW_OPERATOR_ID,
        },
      ]);
      const res = await buildLighthouse(NOW);
      expect(res.lighthouse.buckets["24h"].distinct_operator_prefixes).toBe(1);
      expect(maskOperatorPrefix(RAW_OPERATOR_ID)).toBe(RAW_OPERATOR_ID.slice(0, 4));
      expect(JSON.stringify(res)).not.toContain(RAW_OPERATOR_ID);
    });
  });

  describe("buildLighthouse wiring (g)", () => {
    it("maps raw rows through the organic filter for every table", async () => {
      prismaMock.agent.findMany.mockResolvedValue([
        { createdAt: new Date(NOW.getTime() - HOUR), agentId: "real", domain: "CODE", operatorId: "op-1" },
      ]);
      prismaMock.agentEvidence.findMany.mockResolvedValue([
        { createdAt: new Date(NOW.getTime() - HOUR), sourceUrl: "https://real", externalTaskId: null, commitSha: "abc" },
        { createdAt: new Date(NOW.getTime() - HOUR), sourceUrl: "smoke:adopt", externalTaskId: null, commitSha: null },
      ]);
      prismaMock.receipt.findMany.mockResolvedValue([
        { issuedAt: new Date(NOW.getTime() - HOUR), authorityScope: "real-scope", agentId: "real", receiptId: "rec-1", operatorId: "op-1" },
        { issuedAt: new Date(NOW.getTime() - HOUR), authorityScope: "adopt-loop-proof", agentId: "real", receiptId: "rec-2", operatorId: "op-1" },
      ]);
      prismaMock.railSettlement.findMany.mockResolvedValue([
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "rail-real", reference: "r1", status: "SETTLED" },
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "adopt-canary-abc", reference: "adopt-1-settle", status: "SETTLED" },
        // spam vector: a bad-signature attempt must NOT count as adoption
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "rail-real", reference: "r2-spam", status: "REJECTED" },
      ]);
      prismaMock.railSpec.findMany.mockResolvedValue([
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "rail-real", name: "Real Rail", state: "ENABLED" },
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "adopt-canary-abc", name: "Adoption Canary", state: "ENABLED" },
        { createdAt: new Date(NOW.getTime() - HOUR), railKey: "rail-disabled", name: "Disabled", state: "PROPOSED" },
      ]);

      const res = await buildLighthouse(NOW);
      const b = res.lighthouse.buckets["24h"];
      expect(b.enrolled_agents).toBe(1);
      expect(b.evidence_events).toBe(1);
      expect(b.receipts).toBe(1);
      expect(b.settlements).toBe(1);
      expect(b.enabled_rails).toBe(1);
    });
  });
});
