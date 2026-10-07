import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { acquireLeaseMock, sendTelegramMock, watchAllMock } = vi.hoisted(() => ({
  acquireLeaseMock: vi.fn(),
  sendTelegramMock: vi.fn(async () => true),
  watchAllMock: vi.fn(async () => ({ overall: "ok" })),
}));

vi.mock("@/lib/scheduler/lease", () => ({
  acquireLease: acquireLeaseMock,
  LEASE_TTL_MS: 600_000,
}));
vi.mock("@/lib/commander/watch", () => ({
  watchAll: watchAllMock,
  renderFleetWatch: vi.fn(() => "digest"),
}));
vi.mock("@/lib/telegram/commander", () => ({
  telegramConfigured: () => true,
  commanderChatIds: () => ["123"],
  sendTelegramMessage: sendTelegramMock,
}));

import { runFleetWatchDigest } from "../fleet-watch-scheduler";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("runFleetWatchDigest — single-flight", () => {
  it("skips when another replica holds the lease (no duplicate Telegram)", async () => {
    acquireLeaseMock.mockResolvedValue(null);
    await runFleetWatchDigest();
    expect(sendTelegramMock).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the lease store is unreachable", async () => {
    acquireLeaseMock.mockRejectedValue(new Error("db down"));
    await expect(runFleetWatchDigest()).resolves.toBeUndefined();
    expect(sendTelegramMock).not.toHaveBeenCalled();
  });

  it("runs the digest and releases the lease when it is the holder", async () => {
    const release = vi.fn(async () => {});
    acquireLeaseMock.mockResolvedValue({ id: "fleet-watch", ownerId: "o", release });
    await runFleetWatchDigest();
    expect(watchAllMock).toHaveBeenCalled();
    expect(sendTelegramMock).toHaveBeenCalledWith("123", "digest");
    expect(release).toHaveBeenCalled();
  });
});
