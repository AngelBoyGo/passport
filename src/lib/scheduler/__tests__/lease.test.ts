import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    brainLease: { updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { acquireLease, releaseLease } from "../lease";

describe("scheduler lease registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.brainLease.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.brainLease.create.mockRejectedValue(new Error("exists"));
    prismaMock.brainLease.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("acquires a free lease via atomic takeover and releases it", async () => {
    const handle = await acquireLease("scheduler-tick");
    expect(handle).not.toBeNull();
    expect(handle!.id).toBe("scheduler-tick");
    expect(prismaMock.brainLease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "scheduler-tick" }),
      })
    );

    await handle!.release();
    expect(prismaMock.brainLease.deleteMany).toHaveBeenCalledWith({
      where: { id: "scheduler-tick", ownerId: handle!.ownerId },
    });
  });

  it("returns null when another live holder owns the lease (create conflicts)", async () => {
    prismaMock.brainLease.updateMany.mockResolvedValue({ count: 0 });
    const handle = await acquireLease("revenue-runner");
    expect(handle).toBeNull();
  });

  it("throws when the lease store is unreachable — callers must fail closed", async () => {
    prismaMock.brainLease.updateMany.mockRejectedValue(new Error("db down"));
    await expect(acquireLease("scheduler-tick")).rejects.toThrow("db down");
  });

  it("release only deletes rows the owner still holds", async () => {
    await releaseLease("scheduler-tick", "lease_someone_else");
    expect(prismaMock.brainLease.deleteMany).toHaveBeenCalledWith({
      where: { id: "scheduler-tick", ownerId: "lease_someone_else" },
    });
  });

  it("each job uses its own lease id (independent single-flight)", async () => {
    const a = await acquireLease("scheduler-tick");
    const b = await acquireLease("revenue-runner");
    expect(a!.id).toBe("scheduler-tick");
    expect(b!.id).toBe("revenue-runner");
    const ids = prismaMock.brainLease.updateMany.mock.calls.map(
      (c: unknown[]) => (c[0] as { where: { id: string } }).where.id
    );
    expect(new Set(ids)).toEqual(new Set(["scheduler-tick", "revenue-runner"]));
  });
});