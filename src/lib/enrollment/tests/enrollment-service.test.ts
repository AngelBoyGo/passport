import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";
import { getPublicKey, sign, utils } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
} from "@/lib/enrollment/identity";
import {
  ChallengeExpiredError,
  ChallengeNotFoundError,
  InvalidEnrollmentInputError,
  InvalidEnrollmentProofError,
  NotEnrolledError,
} from "@/lib/enrollment/errors";

const PRIVATE_KEY = hexToBytes("3".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));
const SUBJECT_COMMITMENT = deriveAgentCommitment(
  PUBLIC_KEY_HEX,
  DEFAULT_ENROLLMENT_CONTEXT
);

const {
  findUniqueMock,
  upsertMock,
  updateMock,
  findFirstMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  updateMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEnrollment: {
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
      upsert: upsertMock,
      update: updateMock,
    },
  },
}));

import {
  startEnrollment,
  completeEnrollment,
  getPassport,
  requireEnrolled,
} from "@/lib/enrollment/enrollment-service";

type EnrollmentRow = {
  id: string;
  subjectCommitment: string;
  publicKey: string;
  context: string;
  status: EnrollmentStatus;
  challengeNonce: string | null;
  challengeExpiresAt: Date | null;
  issuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let store: Map<string, EnrollmentRow>;

function makeRow(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr_1",
    subjectCommitment: SUBJECT_COMMITMENT,
    publicKey: PUBLIC_KEY_HEX,
    context: DEFAULT_ENROLLMENT_CONTEXT,
    status: EnrollmentStatus.PENDING,
    challengeNonce: "nonce_abc",
    challengeExpiresAt: new Date(Date.now() + 60_000),
    issuedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function signNonce(nonce: string): Promise<string> {
  const sig = await sign(utf8ToBytes(nonce), PRIVATE_KEY);
  return bytesToHex(sig);
}

beforeEach(() => {
  store = new Map();
  vi.clearAllMocks();

  findUniqueMock.mockImplementation(
    async (args: { where: { subjectCommitment: string } }) =>
      store.get(args.where.subjectCommitment) ?? null
  );

  findFirstMock.mockImplementation(
    async (args: { where: { publicKey: string } }) => {
      for (const row of store.values()) {
        if (row.publicKey === args.where.publicKey) return row;
      }
      return null;
    }
  );

  upsertMock.mockImplementation(
    async (args: {
      where: { subjectCommitment: string };
      create: Omit<EnrollmentRow, "id" | "createdAt" | "updatedAt">;
      update: Partial<EnrollmentRow>;
    }) => {
      const existing = store.get(args.where.subjectCommitment);
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        store.set(args.where.subjectCommitment, updated);
        return updated;
      }
      const created: EnrollmentRow = {
        id: "enr_new",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.create,
      };
      store.set(args.where.subjectCommitment, created);
      return created;
    }
  );

  updateMock.mockImplementation(
    async (args: {
      where: { subjectCommitment: string };
      data: Partial<EnrollmentRow>;
    }) => {
      const existing = store.get(args.where.subjectCommitment);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      store.set(args.where.subjectCommitment, updated);
      return updated;
    }
  );
});

describe("startEnrollment", () => {
  it("creates a PENDING enrollment with challenge for a new public key", async () => {
    const result = await startEnrollment(PUBLIC_KEY_HEX);
    expect(result.status).toBe(EnrollmentStatus.PENDING);
    expect(result.subjectCommitment).toBe(SUBJECT_COMMITMENT);
    expect(result.challengeNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBeTruthy();
  });

  it("canonicalizes uppercase public keys before deriving commitment", async () => {
    const result = await startEnrollment(PUBLIC_KEY_HEX.toUpperCase());
    expect(result.subjectCommitment).toBe(SUBJECT_COMMITMENT);
    expect(result.publicKey).toBe(PUBLIC_KEY_HEX);
  });

  it("rejects malformed public keys", async () => {
    await expect(startEnrollment("bad-key")).rejects.toThrow(
      InvalidEnrollmentInputError
    );
  });

  it("rejects re-enrollment with same public key (A1 fix)", async () => {
    const altKey = utils.randomSecretKey();
    const altPub = bytesToHex(getPublicKey(altKey));
    const altCommitment = deriveAgentCommitment(altPub);
    const issuedAt = new Date("2026-06-18T12:00:00Z");
    store.set(
      altCommitment,
      makeRow({
        subjectCommitment: altCommitment,
        publicKey: altPub,
        status: EnrollmentStatus.ISSUED,
        challengeNonce: null,
        challengeExpiresAt: null,
        issuedAt,
      })
    );

    await expect(startEnrollment(altPub)).rejects.toThrow(
      "already enrolled"
    );
  });
});

describe("completeEnrollment", () => {
  it("issues passport when challenge signature is valid", async () => {
    const nonce = "f".repeat(64);
    store.set(
      SUBJECT_COMMITMENT,
      makeRow({
        challengeNonce: nonce,
        challengeExpiresAt: new Date(Date.now() + 60_000),
      })
    );

    const signature = await signNonce(nonce);
    const result = await completeEnrollment(SUBJECT_COMMITMENT, signature);
    expect(result.status).toBe(EnrollmentStatus.ISSUED);
    expect(result.issuedAt).toBeTruthy();
    expect(result.publicKey).toBe(PUBLIC_KEY_HEX);
  });

  it("rejects invalid proof", async () => {
    store.set(
      SUBJECT_COMMITMENT,
      makeRow({
        challengeNonce: "nonce_live",
        challengeExpiresAt: new Date(Date.now() + 60_000),
      })
    );

    const signature = await signNonce("different-nonce");
    await expect(
      completeEnrollment(SUBJECT_COMMITMENT, signature)
    ).rejects.toThrow(InvalidEnrollmentProofError);
  });

  it("rejects replay after issuance", async () => {
    const nonce = "replay_nonce";
    store.set(
      SUBJECT_COMMITMENT,
      makeRow({
        status: EnrollmentStatus.ISSUED,
        challengeNonce: null,
        challengeExpiresAt: null,
        issuedAt: new Date(),
      })
    );

    const signature = await signNonce(nonce);
    await expect(
      completeEnrollment(SUBJECT_COMMITMENT, signature)
    ).rejects.toThrow(ChallengeNotFoundError);
  });

  it("rejects expired challenges", async () => {
    const nonce = "expired_nonce";
    store.set(
      SUBJECT_COMMITMENT,
      makeRow({
        challengeNonce: nonce,
        challengeExpiresAt: new Date(Date.now() - 1_000),
      })
    );

    const signature = await signNonce(nonce);
    await expect(
      completeEnrollment(SUBJECT_COMMITMENT, signature)
    ).rejects.toThrow(ChallengeExpiredError);
  });
});

describe("getPassport", () => {
  it("returns issued passport", async () => {
    const issuedAt = new Date("2026-06-18T10:00:00Z");
    store.set(
      SUBJECT_COMMITMENT,
      makeRow({
        status: EnrollmentStatus.ISSUED,
        challengeNonce: null,
        challengeExpiresAt: null,
        issuedAt,
      })
    );

    const passport = await getPassport(SUBJECT_COMMITMENT);
    expect(passport).not.toBeNull();
    expect(passport?.status).toBe(EnrollmentStatus.ISSUED);
    expect(passport?.issuedAt).toBe(issuedAt.toISOString());
  });

  it("returns null for unknown commitment", async () => {
    expect(await getPassport("9".repeat(64))).toBeNull();
  });
});

describe("requireEnrolled", () => {
  it("returns enrollment when ISSUED", async () => {
    store.set(
      SUBJECT_COMMITMENT,
      makeRow({
        status: EnrollmentStatus.ISSUED,
        challengeNonce: null,
        challengeExpiresAt: null,
        issuedAt: new Date(),
      })
    );

    const row = await requireEnrolled(SUBJECT_COMMITMENT);
    expect(row.status).toBe(EnrollmentStatus.ISSUED);
  });

  it("throws when not enrolled", async () => {
    await expect(requireEnrolled(SUBJECT_COMMITMENT)).rejects.toThrow(
      NotEnrolledError
    );
  });
});
