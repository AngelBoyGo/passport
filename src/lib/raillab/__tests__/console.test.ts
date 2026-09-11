import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    integrityAttestation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    executionSafetyFlag: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    railSpec: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    railSettlement: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    breachResponse: { findUnique: vi.fn(), create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { buildTrustConsole } from "../console";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { hashIntegrityAttestation, getIntegrityPublicKeyHex } from "../attest";

const SEED = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");

/** Builds a valid signed attestation row fixture (uses the real signer key). */
async function signedAttestation(overrides: Partial<Record<string, unknown>> = {}) {
  // Use a millis-bearing ISO string so Date#toISOString() round-trips to the SAME string the
  // hash was computed over (a no-millis string would NOT match toISOString's ".000Z").
  const checkedAtIso = "2026-01-01T00:00:00.000Z";
  const body = {
    attestationId: "attest_1",
    checkedAt: checkedAtIso,
    ok: true,
    supplyConsistent: true,
    fractionalConsistent: true,
    lpInvariantOk: true,
    pendingReviewStale: 0,
    settledTotalCredited: 0,
    settledTotalRows: 0,
    issues: [] as string[],
  };
  const attestationHash = hashIntegrityAttestation(body);
  const signature = bytesToHex(await sign(utf8ToBytes(attestationHash), SEED));
  return {
    ...overrides,
    ...body,
    checkedAt: new Date(checkedAtIso), // Prisma rows expose Date, not string
    attestationHash,
    signature,
    publicKey: getIntegrityPublicKeyHex(),
    algorithm: "ed25519",
    createdAt: new Date(),
  };
}

async function mockHealthyBase(attestationOverrides: Partial<Record<string, unknown>> = {}) {
  prismaMock.executionSafetyFlag.findUnique.mockResolvedValue(null); // no flag -> not halted
  prismaMock.integrityAttestation.findUnique.mockResolvedValue(null); // no prev chain link needed
  prismaMock.railSpec.findMany.mockResolvedValue([
    { state: "ENABLED", ledgerKind: "PAYMENT" },
    { state: "QUARANTINED", ledgerKind: "FRACTIONAL" },
  ]);
  prismaMock.railSettlement.findMany.mockResolvedValue([]); // no velocity burst
  prismaMock.railSettlement.count.mockResolvedValue(0); // no stale pending
  // LATEST attestation fixture (real signed hash+signature) — await so the mock resolves to the
  // data object, not a nested Promise.
  const latest = await signedAttestation(attestationOverrides);
  prismaMock.integrityAttestation.findFirst.mockResolvedValue(latest);
  return latest;
}

describe("Operational Trust Console (Phase 25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.SIGNING_PRIVATE_KEY = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  });

  it("aggregates a healthy console with OK severity and a VERIFIED attestation", async () => {
    await mockHealthyBase();
    const c = await buildTrustConsole();
    expect(c.severity).toBe("OK");
    expect(c.attestation.verified).toBe(true);
    expect(c.attestation.chainOk).toBe(true);
    expect(c.safety.halted).toBe(false);
    expect(c.rails.total).toBe(2);
    expect(c.rails.enabled).toBe(1);
    expect(c.rails.quarantined).toBe(1);
    expect(c.rails.byKind.PAYMENT).toBe(1);
  });

  it("flags SEVERE when the interlock is halted", async () => {
    await mockHealthyBase();
    prismaMock.executionSafetyFlag.findUnique.mockResolvedValue({
      id: "global", liveExecutionHalted: true, haltedAt: new Date(), reason: "integrity breach",
      causedByAttestationId: "attest_1", version: 2,
    });
    const c = await buildTrustConsole();
    expect(c.severity).toBe("SEVERE");
    expect(c.safety.halted).toBe(true);
    expect(c.safety.causedByAttestationId).toBe("attest_1");
    expect(c.cacheControl).toBe("no-store");
  });

it("flags SEVERE when the attestation chain does not verify", async () => {
    // Tamper AFTER signing: flip ok from true->false so hash recompute mismatches the stored hash,
    // AND give it a prev link that does NOT resolve to a stored row (broken chain).
    const tampered = {
      ...(await signedAttestation()),
      ok: false,
      prevAttestationHash: "missing-prev-hash",
    };
    await mockHealthyBase();
    prismaMock.integrityAttestation.findFirst.mockResolvedValue(tampered);
    prismaMock.integrityAttestation.findUnique.mockResolvedValue(null); // prev hash not found -> chain broken
    const c = await buildTrustConsole();
    expect(c.severity).toBe("SEVERE");
    expect(c.attestation.verified).toBe(false);
    expect(c.attestation.chainOk).toBe(false);
    expect(c.attestation.prevLinked).toBe(false);
  });

  it("flags WARNING on a settlement-velocity burst", async () => {
    await mockHealthyBase();
    prismaMock.railSettlement.findMany.mockResolvedValue(
      Array.from({ length: 30 }, () => ({ railKey: "rail-1" })) // 30 > 25 threshold
    );
    const c = await buildTrustConsole();
    expect(c.severity).toBe("WARNING");
    expect(c.rails.velocityAlerts.length).toBe(1);
    expect(c.cacheControl).toBe("public, max-age=30");
  });

  it("handles a missing safety flag without crashing and stays OK when healthy", async () => {
    await mockHealthyBase();
    prismaMock.executionSafetyFlag.findUnique.mockResolvedValue(null);
    const c = await buildTrustConsole();
    expect(c.safety.halted).toBe(false);
    expect(c.safety.version).toBe(1);
  });

  it("is bounded with 100 rails", async () => {
    await mockHealthyBase();
    const rails = Array.from({ length: 100 }, (_, i) => ({
      state: i % 2 === 0 ? "ENABLED" : "QUARANTINED",
      ledgerKind: i % 3 === 0 ? "PAYMENT" : i % 3 === 1 ? "FRACTIONAL" : "LP",
    }));
    prismaMock.railSpec.findMany.mockResolvedValue(rails);
    const c = await buildTrustConsole();
    expect(c.rails.total).toBe(100);
    expect(Object.keys(c.rails.byKind).length).toBeLessThanOrEqual(4);
  });
});




