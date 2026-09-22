import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createEngagementMock, leaseAcquireMock, leaseReleaseMock } = vi.hoisted(() => ({
  prismaMock: {
    moneyIntent: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  createEngagementMock: vi.fn(),
  leaseAcquireMock: vi.fn(),
  leaseReleaseMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/engagement/engagement-service", () => ({ createEngagement: createEngagementMock }));
vi.mock("@/lib/scheduler/lease", () => ({
  acquireLease: leaseAcquireMock,
  releaseLease: leaseReleaseMock,
}));

const { executeAuthorizedIntents, runFleetDispatchTick } = await import("@/lib/fleet/fleet-executor");

function authorizedIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "mi_1",
    intentKind: "hire_agent",
    workerCommitment: "b".repeat(64),
    requesterCommitment: "c".repeat(64),
    amountAngels: 12,
    signature: "f".repeat(128),
    status: "AUTHORIZED",
    intentDigest: "d".repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  prismaMock.moneyIntent.findMany.mockReset();
  prismaMock.moneyIntent.update.mockReset();
  prismaMock.moneyIntent.update.mockResolvedValue({});
  createEngagementMock.mockReset();
  process.env.FLEET_HALT = "";
});

describe("fleet executor — authorized intents become real escrowed engagements", () => {
  it("creates the engagement with the money agent as HIRER, then EXECUTED", async () => {
    prismaMock.moneyIntent.findMany.mockResolvedValue([authorizedIntent()]);
    createEngagementMock.mockResolvedValue({ taskId: "fleet_mi_1", status: "HELD" });

    const report = await executeAuthorizedIntents();

    expect(report.executed).toEqual(["mi_1"]);
    expect(createEngagementMock).toHaveBeenCalledWith({
      taskId: "fleet_mi_1",
      hirerCommitment: "c".repeat(64),
      workerCommitment: "b".repeat(64),
      amount: 12,
    });
    expect(prismaMock.moneyIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "mi_1" }, data: expect.objectContaining({ status: "EXECUTED" }) })
    );
  });

  it("insufficient escrow balance stays AUTHORIZED (retriable), reason recorded", async () => {
    prismaMock.moneyIntent.findMany.mockResolvedValue([authorizedIntent()]);
    createEngagementMock.mockRejectedValue(new Error("insufficient balance"));
    const report = await executeAuthorizedIntents();
    expect(report.executed).toEqual([]);
    expect(report.retriable_failures[0].error).toBe("insufficient balance");
    expect(prismaMock.moneyIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mi_1" },
        data: expect.objectContaining({ rejectionReason: expect.stringContaining("exec_attempt_failed") }),
      })
    );
  });

  it("hirer === worker is refused permanently (REJECTED), never retried forever", async () => {
    prismaMock.moneyIntent.findMany.mockResolvedValue([
      authorizedIntent({ workerCommitment: "c".repeat(64), requesterCommitment: "c".repeat(64) }),
    ]);
    const report = await executeAuthorizedIntents();
    expect(createEngagementMock).not.toHaveBeenCalled();
    expect(prismaMock.moneyIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) })
    );
    expect(report.retriable_failures[0].error).toBe("invalid_parties");
  });

  it("unsupported intent kinds are skipped (recorded), not executed, simulate not executed forever", async () => {
    prismaMock.moneyIntent.findMany.mockResolvedValue([
      authorizedIntent({ intentKind: "fund_compute" }),
    ]);
    const report = await executeAuthorizedIntents();
    expect(report.skipped).toBe(1);
    expect(createEngagementMock).not.toHaveBeenCalled();
  });

  it("FLEET_HALT blocks every execution (kill switch covers money flows too)", async () => {
    const previous = process.env.FLEET_HALT;
    process.env.FLEET_HALT = "true";
    try {
      const report = await executeAuthorizedIntents();
      expect(report.halted).toBe(true);
      expect(prismaMock.moneyIntent.findMany).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.FLEET_HALT;
      else process.env.FLEET_HALT = previous;
    }
  });

  it("empty queue is a clean no-op", async () => {
    prismaMock.moneyIntent.findMany.mockResolvedValue([]);
    const report = await executeAuthorizedIntents();
    expect(report.executed).toEqual([]);
    expect(report.retriable_failures).toEqual([]);
  });
});

describe("dispatch tick — single-flight", () => {
  it("skips without the lease (another replica holds it) and runs nothing", async () => {
    leaseAcquireMock.mockReset().mockResolvedValue(null);
    const result = await runFleetDispatchTick();
    expect(result.ran_lease).toBe(false);
    expect(result.report).toBeNull();
    expect(prismaMock.moneyIntent.findMany).not.toHaveBeenCalled();
  });

  it("acquires the lease, runs, releases", async () => {
    leaseAcquireMock.mockReset().mockResolvedValue({ ownerId: "op1", release: () => Promise.resolve() });
    leaseReleaseMock.mockReset().mockResolvedValue(undefined);
    prismaMock.moneyIntent.findMany.mockResolvedValue([]);
    const result = await runFleetDispatchTick();
    expect(result.ran_lease).toBe(true);
    expect(leaseReleaseMock).toHaveBeenCalledWith("fleet-dispatch", "op1");
  });
});
