import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { acquireLeaseMock, moltbookReadMock } = vi.hoisted(() => ({
  acquireLeaseMock: vi.fn(),
  moltbookReadMock: vi.fn(async () => ({ fetched: 3, stored: 1 })),
}));

vi.mock("@/lib/scheduler/lease", () => ({
  acquireLease: acquireLeaseMock,
  LEASE_TTL_MS: 600_000,
}));
vi.mock("@/lib/brain/moltbook", () => ({
  moltbookConfigured: () => true,
  moltbookRead: moltbookReadMock,
}));

import { runMoltbookRead } from "../moltbook-scheduler";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("runMoltbookRead — single-flight", () => {
  it("skips when another replica holds the lease", async () => {
    acquireLeaseMock.mockResolvedValue(null);
    await runMoltbookRead();
    expect(moltbookReadMock).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the lease store is unreachable", async () => {
    acquireLeaseMock.mockRejectedValue(new Error("db down"));
    await expect(runMoltbookRead()).resolves.toBeUndefined();
    expect(moltbookReadMock).not.toHaveBeenCalled();
  });

  it("reads and releases the lease when it is the holder", async () => {
    const release = vi.fn(async () => {});
    acquireLeaseMock.mockResolvedValue({ id: "moltbook-read", ownerId: "o", release });
    await runMoltbookRead();
    expect(moltbookReadMock).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
