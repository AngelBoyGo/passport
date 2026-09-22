import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, verifySigMock } = vi.hoisted(() => {
  const prismaMock = {
    moneyIntent: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    agentInstance: {
      findUnique: vi.fn(),
    },
    agentEnrollment: {
      findUnique: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
  };
  return { prismaMock, verifySigMock: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/verifyPinnedSignature", () => ({ verifyPinnedSignature: verifySigMock }));

const { authorizeMoneyMovement, stageMoneyIntent, canonicalIntent, intentDigest } =
  await import("@/lib/fleet/money-intent");

const INTENT = {
  intentKind: "hire_agent",
  workerCommitment: "b".repeat(64),
  amountAngels: 12,
  cycleRef: "cyc_test",
};

beforeEach(() => {
  prismaMock.moneyIntent.findUnique.mockReset();
  prismaMock.moneyIntent.update.mockReset();
  prismaMock.moneyIntent.update.mockResolvedValue({});
  prismaMock.moneyIntent.create.mockReset();
  prismaMock.adminAuditLog.create.mockReset();
  prismaMock.adminAuditLog.create.mockResolvedValue({});
  verifySigMock.mockReset();
});

describe("money-intent — staging (the brain's ONLY money side effect)", () => {
  it("stages a valid intent as PENDING", async () => {
    prismaMock.moneyIntent.create.mockResolvedValue({ id: "mi1", intentDigest: "x" });
    const staged = await stageMoneyIntent({ ...INTENT, reason: "hire transcript parser" });
    expect(staged.ok).toBe(true);
    expect(prismaMock.moneyIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    );
  });

  it("rejects unknown kinds and non-positive/over-cap amounts BEFORE any write", async () => {
    const badKind = await stageMoneyIntent({ ...INTENT, intentKind: "dark_pool", reason: "x" });
    if (badKind.ok) throw new Error("dark_pool should not stage");
    expect(badKind.reason).toMatch(/intent_kind_unknown/);
    const zero = await stageMoneyIntent({ ...INTENT, amountAngels: 0, reason: "x" });
    if (zero.ok) throw new Error("zero amount should not stage");
    expect(zero.reason).toBe("intent_amount_invalid");
    const huge = await stageMoneyIntent({ ...INTENT, amountAngels: 99999999, reason: "x" });
    if (huge.ok) throw new Error("over-cap amount should not stage");
    expect(huge.reason).toMatch(/intent_above_cap/);
    expect(prismaMock.moneyIntent.create).not.toHaveBeenCalled();
  });
});

describe("money-intent — the triple-gate authorization", () => {
  function intentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "mi_x",
      intentKind: INTENT.intentKind,
      workerCommitment: INTENT.workerCommitment,
      amountAngels: INTENT.amountAngels,
      cycleRef: INTENT.cycleRef,
      intentDigest: intentDigest(INTENT),
      status: "PENDING",
      ...overrides,
    };
  }

  function agentRow(llmTier = "money", status = "active") {
    return { commitment: "c".repeat(64), llmTier: tier(llmTier), status };
  }
  function tier(llmTier: string) {
    return llmTier;
  }

  it("condition 1: the fleet money switch OFF rejects with money_movement_disabled", async () => {
    const previous = process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    prismaMock.moneyIntent.findUnique.mockResolvedValue(intentRow());
    prismaMock.agentInstance.findUnique.mockResolvedValue(agentRow());
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({ publicKey: "k".repeat(64), status: "ISSUED" });
    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("money_movement_disabled");
    expect(prismaMock.moneyIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) })
    );
    if (previous === undefined) delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    else process.env.FLEET_MONEY_MOVEMENT_ENABLED = previous;
  });

  it("condition 2: a neuron-PROVISIONED verifier is refused even with the switch ON", async () => {
    const previous = process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    process.env.FLEET_MONEY_MOVEMENT_ENABLED = "true";
    prismaMock.moneyIntent.findUnique.mockResolvedValue(intentRow());
    prismaMock.agentInstance.findUnique.mockResolvedValue(agentRow("neuron"));
    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(result.reason).toBe("verifier_not_money_tier:neuron");
    if (previous === undefined) delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    else process.env.FLEET_MONEY_MOVEMENT_ENABLED = previous;
  });

  it("a stopped verifier never authorizes", async () => {
    const previous = process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    process.env.FLEET_MONEY_MOVEMENT_ENABLED = "true";
    prismaMock.moneyIntent.findUnique.mockResolvedValue(intentRow());
    prismaMock.agentInstance.findUnique.mockResolvedValue(agentRow("money", "stopped"));
    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(result.reason).toBe("verifier_instance_stopped");
    if (previous === undefined) delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    else process.env.FLEET_MONEY_MOVEMENT_ENABLED = previous;
  });

  it("a garbage verifier commitment fails closed before the tier read", async () => {
    process.env.FLEET_MONEY_MOVEMENT_ENABLED = "true";
    prismaMock.moneyIntent.findUnique.mockResolvedValue(intentRow());
    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "not-hex",
      signature: "f".repeat(128),
    });
    expect(result.reason).toBe("verifier_commitment_invalid");
  });

  it("process.env switch ON + money verifier but FORGED signature → intent_signature_invalid", async () => {
    const previous = process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    process.env.FLEET_MONEY_MOVEMENT_ENABLED = "true";
    prismaMock.moneyIntent.findUnique.mockResolvedValue(intentRow());
    prismaMock.agentInstance.findUnique.mockResolvedValue(agentRow());
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({ publicKey: "k".repeat(64), status: "ISSUED" });
    verifySigMock.mockResolvedValue({ valid: false, reason: "signature_mismatch" });
    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(result.reason).toBe("intent_signature_invalid");
    if (previous === undefined) delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    else process.env.FLEET_MONEY_MOVEMENT_ENABLED = previous;
  });

  it("all three conditions met → AUTHORIZED with audit, and NOT re-authorizable", async () => {
    const previous = process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    process.env.FLEET_MONEY_MOVEMENT_ENABLED = "true";
    prismaMock.moneyIntent.findUnique
      .mockResolvedValueOnce(intentRow())
      .mockResolvedValueOnce(intentRow({ status: "AUTHORIZED" }));
    prismaMock.agentInstance.findUnique.mockResolvedValue(agentRow());
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({ publicKey: "k".repeat(64), status: "ISSUED" });
    verifySigMock.mockResolvedValue({ valid: true });
    prismaMock.moneyIntent.update.mockImplementation((args: { where?: { id?: string } }) =>
      Promise.resolve({ ...intentRow(), id: args?.where?.id ?? "mi_x" })
    );

    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(result.ok).toBe(true);
    expect(prismaMock.adminAuditLog.create).toHaveBeenCalled();

    // second attempt: status guard refuses (single-use)
    const second = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("intent_not_pending:AUTHORIZED");
    if (previous === undefined) delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    else process.env.FLEET_MONEY_MOVEMENT_ENABLED = previous;
  });

  it("a tampered in-cap amount (digest mismatch) is caught even with a valid signature", async () => {
    const previous = process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    process.env.FLEET_MONEY_MOVEMENT_ENABLED = "true";
    prismaMock.moneyIntent.findUnique.mockResolvedValue(
      intentRow({ amountAngels: 13 }) // in-cap tamper: cap passes, digest breaks
    );
    prismaMock.agentInstance.findUnique.mockResolvedValue(agentRow());
    const result = await authorizeMoneyMovement({
      intentId: "mi_x",
      verifierCommitment: "c".repeat(64),
      signature: "f".repeat(128),
    });
    expect(result.reason).toBe("intent_digest_mismatch");
    if (previous === undefined) delete process.env.FLEET_MONEY_MOVEMENT_ENABLED;
    else process.env.FLEET_MONEY_MOVEMENT_ENABLED = previous;
  });
});

describe("canonical intent stability", () => {
  it("is deterministic and field-ordered", () => {
    const a = canonicalIntent(INTENT);
    const b = canonicalIntent({ ...INTENT });
    expect(a).toBe(b);
    expect(a).toContain('"kind":"hire_agent"');
    expect(intentDigest(INTENT)).toHaveLength(64);
  });
});
