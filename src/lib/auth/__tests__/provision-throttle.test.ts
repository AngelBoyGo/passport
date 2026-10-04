import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    provisioningThrottle: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { consumeProvisioningSlot, windowStart } = await import("@/lib/auth/provision-throttle");

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisioning throttle (H3 Sybil resistance — DB-backed)", () => {
  it("allows when the guarded increment matches a row under the limit", async () => {
    prismaMock.provisioningThrottle.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.provisioningThrottle.findUnique.mockResolvedValue({ count: 2 });
    const r = await consumeProvisioningSlot("autonomous_ip", "1.2.3.4", 3);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(2);
  });

  it("allows the FIRST slot by creating the row", async () => {
    prismaMock.provisioningThrottle.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.provisioningThrottle.create.mockResolvedValue({ count: 1 });
    const r = await consumeProvisioningSlot("autonomous_ip", "1.2.3.4", 3);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it("REFUSES when the window is at the limit (P2002 race-loser path)", async () => {
    prismaMock.provisioningThrottle.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.provisioningThrottle.create.mockRejectedValue({ code: "P2002" });
    prismaMock.provisioningThrottle.findUnique.mockResolvedValue({ count: 3 });
    const r = await consumeProvisioningSlot("autonomous_ip", "1.2.3.4", 3);
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(3);
  });

  it("windows are fixed 24h buckets (stable windowStart)", () => {
    const t = 1_000_000_000_000;
    const a = windowStart(t, DAY).getTime();
    const b = windowStart(t + 1000, DAY).getTime();
    expect(a).toBe(b); // same bucket for any t within the window
    const c = windowStart(a + DAY, DAY).getTime();
    expect(c).toBe(a + DAY); // exactly one window later
  });
});
