import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    keyLogEntry: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  getKeyTransparencyLog,
  syncKeyTransparencyLog,
  findKeyInTransparencyLog,
} from "@/lib/transparency/key-log";

describe("Key Transparency Log — rotation persistence & pinned lookup", () => {
  const ACTIVE_SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY = ACTIVE_SEED;
    delete process.env.SIGNING_PRIVATE_KEY_PREVIOUS;
  });

  it("log lists only the active key when no previous key is configured", () => {
    const log = getKeyTransparencyLog();
    expect(log.entries.length).toBe(1);
    expect(log.entries[0].status).toBe("active");
  });

  it("log also includes a rotated previous key for the rotation window (F2 fix)", () => {
    const prevSeed = "2222222222222222222222222222222222222222222222222222222222222222";
    process.env.SIGNING_PRIVATE_KEY_PREVIOUS = prevSeed;
    const prevPub = bytesToHex(getPublicKey(hexToBytes(prevSeed))).toLowerCase();

    const log = getKeyTransparencyLog();
    expect(log.entries.length).toBe(2);
    const rotated = log.entries.find((e) => e.status === "rotated");
    expect(rotated).toBeDefined();
    expect(rotated!.public_key).toBe(prevPub);
  });

  it("sync persists active + rotation keys idempotently (durability)", async () => {
    prismaMock.keyLogEntry.upsert.mockResolvedValue({ id: "row" });
    await syncKeyTransparencyLog();
    expect(prismaMock.keyLogEntry.upsert).toHaveBeenCalledTimes(1); // active only

    process.env.SIGNING_PRIVATE_KEY_PREVIOUS = "3333333333333333333333333333333333333333333333333333333333333333";
    await syncKeyTransparencyLog();
    expect(prismaMock.keyLogEntry.upsert).toHaveBeenCalledTimes(3); // active + rotated
  });

  it("findKeyInTransparencyLog falls back to in-process log for the active key", async () => {
    const activePub = getKeyTransparencyLog().entries[0].public_key;
    const found = await findKeyInTransparencyLog(activePub);
    expect(found).toBe(true);
  });

  it("findKeyInTransparencyLog queries the DB for a non-env retained key (rotation longevity)", async () => {
    prismaMock.keyLogEntry.findFirst.mockResolvedValue({ id: "old_key" });
    // not the current active key, and no env previous → DB path consulted
    const found = await findKeyInTransparencyLog("f".repeat(64));
    expect(found).toBe(true);
    expect(prismaMock.keyLogEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicKeyHex: "f".repeat(64) } })
    );
  });
});