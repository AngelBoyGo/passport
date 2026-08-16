import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  return {
    prismaMock: {
      session: {
        findUnique: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  getSessionFromToken,
  resolveSessionFromTokens,
} from "@/lib/auth/auth-service";

/** Builds a token with a valid signature under the current SESSION_SECRET. */
function makeValidToken(): string {
  const raw = bytesToHex(sha256(utf8ToBytes(`raw-${Math.random()}`)));
  const secret = process.env.SESSION_SECRET || "dev-session-secret";
  const sig = bytesToHex(sha256(utf8ToBytes(raw + secret)));
  return `sess_${raw}${sig}`;
}

/** Builds a token signed under a DIFFERENT (stale) secret. */
function makeStaleToken(): string {
  const raw = bytesToHex(sha256(utf8ToBytes(`stale-${Math.random()}`)));
  const sig = bytesToHex(sha256(utf8ToBytes(raw + "some-old-rotated-secret")));
  return `sess_${raw}${sig}`;
}

const futureDate = new Date(Date.now() + 60_000);

describe("resolveSessionFromTokens (stale-cookie shadowing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for an empty token list", async () => {
    const session = await resolveSessionFromTokens([]);
    expect(session).toBeNull();
  });

  it("resolves a session when the only cookie is valid", async () => {
    const token = makeValidToken();
    prismaMock.session.findUnique.mockResolvedValueOnce({
      id: "s1",
      token,
      expiresAt: futureDate,
      operator: { id: "op1", email: "a@b.c" },
    });

    const session = await resolveSessionFromTokens([token]);
    expect(session).not.toBeNull();
    expect(session!.operator.id).toBe("op1");
  });

  it("skips a stale-signature token and resolves the valid one behind it", async () => {
    const stale = makeStaleToken();
    const valid = makeValidToken();
    prismaMock.session.findUnique.mockResolvedValueOnce({
      id: "s2",
      token: valid,
      expiresAt: futureDate,
      operator: { id: "op2", email: "x@y.z" },
    });

    // Browser sends stale cookie FIRST — old behavior would 401 here.
    const session = await resolveSessionFromTokens([stale, valid]);
    expect(session).not.toBeNull();
    expect(session!.operator.id).toBe("op2");
    // Only one DB lookup: the stale token fails signature check without a query.
    expect(prismaMock.session.findUnique).toHaveBeenCalledTimes(1);
  });

  it("skips a validly-signed token missing from the DB and tries the next", async () => {
    const deadButSigned = makeValidToken();
    const live = makeValidToken();
    prismaMock.session.findUnique
      .mockResolvedValueOnce(null) // dead token not in DB
      .mockResolvedValueOnce({
        id: "s3",
        token: live,
        expiresAt: futureDate,
        operator: { id: "op3", email: "q@r.s" },
      });

    const session = await resolveSessionFromTokens([deadButSigned, live]);
    expect(session).not.toBeNull();
    expect(session!.operator.id).toBe("op3");
  });

  it("returns null when every candidate fails", async () => {
    prismaMock.session.findUnique.mockResolvedValue(null);
    const session = await resolveSessionFromTokens([
      makeStaleToken(),
      makeValidToken(),
    ]);
    expect(session).toBeNull();
  });

  it("getSessionFromToken still verifies signature before DB lookup", async () => {
    const stale = makeStaleToken();
    const result = await getSessionFromToken(stale);
    expect(result).toBeNull();
    expect(prismaMock.session.findUnique).not.toHaveBeenCalled();
  });
});
