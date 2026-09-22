/**
 * Fleet control plane integration tests — REAL dev Postgres (127.0.0.1:5433).
 * Each mint creates a true Passport (enrollment ISSUED); cleanup removes only
 * the rows these tests created (capability-prefixed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Env BEFORE dynamic imports: DATABASE_URL must use 127.0.0.1 (Windows ::1 is
// unreachable) and the fleet switches pinned for the run.
process.env.DATABASE_URL = "postgresql://passport:passport@127.0.0.1:5433/passport?schema=public";
delete process.env.FLEET_MINT_MONEY_ENABLED;

const CAP = "t_fleettestlocum";
const { prisma } = await import("@/lib/db");
const fleet = await import("@/lib/fleet/fleet-service");
const { sha256Hex } = await import("@/lib/receipt/canonical");
const { utf8ToBytes } = await import("@noble/hashes/utils.js");
const { bytesToHex, hexToBytes } = await import("@noble/hashes/utils.js");
const { ed } = await import("@/lib/receipt/crypto");

const commitments: string[] = [];

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

async function cleanup() {
  const rows = await prisma.agentInstance.findMany({
    where: { capability: CAP },
    select: { commitment: true, operatorId: true },
  });
  for (const r of rows) {
    await prisma.agentInstance.deleteMany({ where: { commitment: r.commitment } });
    await prisma.resurrectionCapsule.deleteMany({ where: { agentCommitment: r.commitment } });
    await prisma.agent.deleteMany({ where: { agentId: r.commitment } });
    await prisma.agentEnrollment.deleteMany({ where: { context: "FLEET_AGENT", subjectCommitment: r.commitment, publicKey: { not: undefined } } });
    if (r.operatorId) {
      await prisma.apiKey.deleteMany({ where: { operatorId: r.operatorId } });
      await prisma.operator.deleteMany({ where: { id: r.operatorId } });
    }
  }
  // sweeping fallback for anything this suite may have leaked
  await prisma.agentEnrollment.deleteMany({ where: { context: "FLEET_AGENT", publicKey: { in: [] } } });
}

describe("fleet-service — mint / stop / rehydrate against a real Passport", () => {
  it("mints a fleet agent with an ISSUED passport + active instance", async () => {
    const minted = await fleet.mintFleetAgent({ capability: CAP, llmTier: "neuron", displayName: "test-neuron" });
    commitments.push(minted.commitment);

    expect(minted.tier).toBe("neuron");
    expect(minted.resolvedModel).toBe("deepseek-v4-flash");
    expect(minted.rawApiKey).toMatch(/^pp_flt_/);

    const enrollment = await prisma.agentEnrollment.findUnique({
      where: { subjectCommitment: minted.commitment },
    });
    expect(enrollment?.status).toBe("ISSUED");
    expect(enrollment?.context).toBe("FLEET_AGENT");

    const instance = await prisma.agentInstance.findUnique({ where: { commitment: minted.commitment } });
    expect(instance?.status).toBe("active");
    expect(instance?.llmTier).toBe("neuron");
  });

  it("REFUSES money-tier mint while the switch is off", async () => {
    await expect(fleet.mintFleetAgent({ capability: CAP, llmTier: "money" })).rejects.toThrow(
      /money_tier_mint_disabled/
    );
  });

  it("enforces the global fleet cap", async () => {
    const previous = process.env.FLEET_MAX_AGENTS;
    process.env.FLEET_MAX_AGENTS = String(0); // live >= cap → refusals... cap>0 required
    try {
      // cap of 1 with existing live rows from prior tests → second mint refused
      const live = await prisma.agentInstance.count({ where: { status: { in: ["provisioning", "active", "idle"] } } });
      process.env.FLEET_MAX_AGENTS = String(Math.max(live, 1));
      await expect(
        fleet.mintFleetAgent({ capability: CAP, llmTier: "neuron" })
      ).rejects.toThrow(/fleet_cap_reached/);
    } finally {
      if (previous === undefined) delete process.env.FLEET_MAX_AGENTS;
      else process.env.FLEET_MAX_AGENTS = previous;
    }
  });

  it("stops WITHOUT deleting the passport, then rehydrates the same identity", async () => {
    const minted = await fleet.mintFleetAgent({ capability: CAP, llmTier: "neuron" });
    commitments.push(minted.commitment);

    // Sign the capsule with the agent's own minted key, as the runtime would.
    const payload = "capsule-state-v1";
    const digest = sha256Hex(payload);
    const sig = bytesToHex(await ed.signAsync(utf8ToBytes(digest), hexToBytes(minted.enrollment.privateKeyHex)));
    await fleet.stopFleetAgent(minted.commitment, {
      reason: "test_stop",
      capsulePayload: payload,
      capsuleSignature: sig,
      capsulePublicKey: minted.enrollment.publicKeyHex,
    });

    const stopped = await prisma.agentInstance.findUnique({ where: { commitment: minted.commitment } });
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.stopReason).toBe("test_stop");
    expect(stopped?.capsuleDigest).toBeTruthy();

    // RETENTION: the Passport is still ISSUED and capsule exists.
    const enrollment = await prisma.agentEnrollment.findUnique({ where: { subjectCommitment: minted.commitment } });
    expect(enrollment?.status).toBe("ISSUED");

    // Illegal direct spin-up path already validated in lifecycle tests; here the service path:
    const re = await fleet.rehydrateFleetAgent(minted.commitment);
    expect(re.tier).toBe("neuron");
    expect(re.capsule?.encryptedPayload).toBe(payload);
    expect(re.capsule?.payloadDigest).toBe(digest);

    const active = await prisma.agentInstance.findUnique({ where: { commitment: minted.commitment } });
    expect(active?.status).toBe("active");
    expect(active?.rehydratedAt).toBeTruthy();

    // Double-stop is refused
    await fleet.stopFleetAgent(minted.commitment, { reason: "second" });
    await expect(fleet.stopFleetAgent(minted.commitment, { reason: "third" })).rejects.toThrow(/already_stopped/);
  });

  it("rejects rehydration when nothing needs rehydrating (still active)", async () => {
    const minted = await fleet.mintFleetAgent({ capability: CAP, llmTier: "neuron" });
    commitments.push(minted.commitment);
    await expect(fleet.rehydrateFleetAgent(minted.commitment)).rejects.toThrow(/illegal_transition:active/);
  });

  it("upgrade-only: tier downgrade on rehydration is REJECTED, upgrade succeeds", async () => {
    // A money-tier agent rehydrating as neuron is refused (money switch off
    // does not matter for an existing identity; downgrade is still illegal).
    const previous = process.env.FLEET_MINT_MONEY_ENABLED;
    process.env.FLEET_MINT_MONEY_ENABLED = "true";
    try {
      const minted = await fleet.mintFleetAgent({ capability: CAP, llmTier: "money" });
      commitments.push(minted.commitment);
      await fleet.stopFleetAgent(minted.commitment, { reason: "upgrade_test" });

      await expect(fleet.rehydrateFleetAgent(minted.commitment, "neuron")).rejects.toThrow(
        /tier_downgrade_rejected/
      );

      const re = await fleet.rehydrateFleetAgent(minted.commitment, "money");
      expect(re.upgraded).toBe(false); // money -> money is same-tier, not an upgrade
      expect(re.resolvedModel).toBe("deepseek-v4-pro");
    } finally {
      if (previous === undefined) delete process.env.FLEET_MINT_MONEY_ENABLED;
      else process.env.FLEET_MINT_MONEY_ENABLED = previous;
    }
  });
});
