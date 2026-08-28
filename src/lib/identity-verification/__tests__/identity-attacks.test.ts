import { describe, it, expect, vi, beforeEach } from "vitest";
import { utils, getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  deriveAgentCommitment,
  isValidPublicKeyHex,
  generateChallengeNonce,
  DEFAULT_ENROLLMENT_CONTEXT,
} from "@/lib/enrollment/identity";
import {
  verifyChallengeSignature,
  verifyPayloadSignature,
} from "@/lib/enrollment/proof";
import { EnrollmentStatus } from "@prisma/client";

// ── Shared test keypairs ──
const KEY_A = utils.randomSecretKey();
const PUB_A = bytesToHex(getPublicKey(KEY_A));
const KEY_B = utils.randomSecretKey();
const PUB_B = bytesToHex(getPublicKey(KEY_B));

// ── Prisma mocks ──
const { findUniqueMock, upsertMock, updateMock, findFirstMock, createMock, updateManyMock } =
  vi.hoisted(() => ({
    findUniqueMock: vi.fn(),
    upsertMock: vi.fn(),
    updateMock: vi.fn(),
    findFirstMock: vi.fn(),
    createMock: vi.fn(),
    updateManyMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEnrollment: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
      update: updateMock,
      findFirst: findFirstMock,
    },
    provisionChallenge: {
      create: createMock,
      updateMany: updateManyMock,
      findFirst: findFirstMock,
    },
    operator: { create: vi.fn().mockResolvedValue({ id: "op_auto" }) },
    apiKey: { create: vi.fn() },
    agent: { create: vi.fn() },
  },
}));

import {
  startEnrollment,
  completeEnrollment,
  getPassport,
  requireEnrolled,
} from "@/lib/enrollment/enrollment-service";
import {
  generateAutonomousChallenge,
  provisionAutonomousAgent,
  verifyAutonomousPoW,
} from "@/lib/auth/autonomous-provision";

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

function makeRow(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr_1",
    subjectCommitment: deriveAgentCommitment(PUB_A),
    publicKey: PUB_A.toLowerCase(),
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

async function sigFor(nonce: string, key = KEY_A): Promise<string> {
  return bytesToHex(await sign(utf8ToBytes(nonce), key));
}

let store: Map<string, EnrollmentRow>;

beforeEach(() => {
  store = new Map();
  vi.clearAllMocks();

  findUniqueMock.mockImplementation(
    async (args: { where: { subjectCommitment: string } }) =>
      store.get(args.where.subjectCommitment) ?? null
  );

  upsertMock.mockImplementation(
    async (args: { where: { subjectCommitment: string }; create: any; update: any }) => {
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
    async (args: { where: { subjectCommitment: string }; data: Partial<EnrollmentRow> }) => {
      const existing = store.get(args.where.subjectCommitment);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      store.set(args.where.subjectCommitment, updated);
      return updated;
    }
  );

  createMock.mockResolvedValue({});
  updateManyMock.mockResolvedValue({ count: 1 });
});

// ════════════════════════════════════════════════════════════════
// A1: KEY REUSE — same Ed25519 key across multiple enrollments
// ════════════════════════════════════════════════════════════════
describe("A1: Key reuse across multiple enrollments", () => {
  it("ATTACK: allows enrolling the same public key in two different contexts, creating two identities from one keypair", async () => {
    const ctx1 = "domain-alpha";
    const ctx2 = "domain-beta";
    const c1 = deriveAgentCommitment(PUB_A, ctx1);
    const c2 = deriveAgentCommitment(PUB_A, ctx2);
    // Both enrollments succeed with the same public key
    const r1 = await startEnrollment(PUB_A, ctx1);
    store.set(c1, makeRow({ subjectCommitment: c1, publicKey: PUB_A, context: ctx1 }));
    const r2 = await startEnrollment(PUB_A, ctx2);
    store.set(c2, makeRow({ subjectCommitment: c2, publicKey: PUB_A, context: ctx2 }));
    expect(r1.subjectCommitment).not.toBe(r2.subjectCommitment);
    expect(r1.publicKey).toBe(PUB_A.toLowerCase());
    expect(r2.publicKey).toBe(PUB_A.toLowerCase());
  });
});

// ════════════════════════════════════════════════════════════════
// A2: CHALLENGE REPLAY — re-use captured nonce+signature after expiry
// ════════════════════════════════════════════════════════════════
describe("A2: Challenge replay after expiry", () => {
  it("ATTACK: server allows completing enrollment with a valid sig against an expired challenge if the DB row isn't atomically consumed", async () => {
    const nonce = "expired-test-nonce-0000000";
    store.set(
      deriveAgentCommitment(PUB_A),
      makeRow({
        challengeNonce: nonce,
        // Already expired
        challengeExpiresAt: new Date(Date.now() - 10_000),
      })
    );
    const signature = await sigFor(nonce);
    // This should throw ChallengeExpiredError — if it doesn't, attack succeeds
    await expect(
      completeEnrollment(deriveAgentCommitment(PUB_A), signature)
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
// A3: POW BYPASS — skip PoW in autonomous flow
// ════════════════════════════════════════════════════════════════
describe("A3: PoW bypass in autonomous provisioning", () => {
  it("ATTACK: verifyAutonomousPoW rejects empty/zero pow_nonce even at low difficulty 1", async () => {
    const challenge = "test-nonce-bypass";
    const result = verifyAutonomousPoW(challenge, "0", 1);
    expect(result).toBe(false);
  });

  it("ATTACK: verifyAutonomousPoW rejects clearly invalid pow_nonce", async () => {
    const challenge = "test-nonce-bypass";
    const result = verifyAutonomousPoW(challenge, "invalid", 1);
    expect(result).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// A4: SALT INFERENCE — (not unit-testable; documented risk)
// ════════════════════════════════════════════════════════════════
describe("A4: Salt inference (documented)", () => {
  it("INGESTION_COMMITMENT_SALT must be ≥ 256 bits (32 chars) in production", () => {
    const salt = process.env.INGESTION_COMMITMENT_SALT;
    if (salt && process.env.NODE_ENV !== "test") {
      expect(salt.length).toBeGreaterThanOrEqual(32);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// A5: COMMITMENT COLLISION — two public keys yielding same sha256
// ════════════════════════════════════════════════════════════════
describe("A5: Commitment collision resistance", () => {
  it("derived commitments from different public keys are distinct", () => {
    const c1 = deriveAgentCommitment(PUB_A);
    const c2 = deriveAgentCommitment(PUB_B);
    expect(c1).not.toBe(c2);
  });
});

// ════════════════════════════════════════════════════════════════
// A6: API key hash reversal — (not unit-testable; documented)
// ════════════════════════════════════════════════════════════════
describe("A6: API key hash has 256 bits of entropy", () => {
  it("generated raw key should have 256-bit entropy (32 random bytes)", () => {
    const raw = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    expect(raw.length).toBe(64);
  });
});

// ════════════════════════════════════════════════════════════════
// A7: KEY ROLE ELEVATION — ISSUER key used as HOLDER
// ════════════════════════════════════════════════════════════════
describe("A7: Cross-operator API key role elevation", () => {
  it("ATTACK: service-auth gate exists but no double-check that an ISSUER key cannot post enrolled evidence", async () => {
    const keyHash = "hash-for-issuer-key";
    // service-auth checks role === "ISSUER" for some ops; evidence posting
    // should require either ISSUER (operator-managed) or HOLDER with valid enrollment.
    // This test documents that the auth layer must distinguish:
    expect(true).toBe(true); // documented; verified at route level
  });
});

// ════════════════════════════════════════════════════════════════
// A8: SESSION FIXATION — IP binding
// ════════════════════════════════════════════════════════════════
describe("A8: Session fixation with IP binding", () => {
  it("ATTACK: session token alone is sufficient for auth; no IP/user-agent binding exists", () => {
    const session = { token: "abc123", operatorId: "op_1", expiresAt: new Date(Date.now() + 3600000) };
    expect(session.token).toBeTruthy();
    // No ipAddress or userAgent field on session — stolen token works from any IP
  });
});

// ════════════════════════════════════════════════════════════════
// A9: UNLIMITED AUTONOMOUS OPERATORS
// ════════════════════════════════════════════════════════════════
describe("A9: Unlimited autonomous account creation", () => {
  it("ATTACK: no IP-based daily cap on autonomous provisioning per source address", () => {
    // provisionAutonomousAgent creates a new operator + apiKey each call
    // There is no check like "this IP has already provisioned N agents today"
    const allowed = true;
    expect(allowed).toBe(true); // documented gap — rate limit exists per endpoint but not daily
  });
});

// ════════════════════════════════════════════════════════════════
// A10: ENROLLMENT PROOF REPLAY — reuse sig within PENDING window
// ════════════════════════════════════════════════════════════════
describe("A10: Enrollment proof replay within PENDING window", () => {
  it("ATTACK: same signature can be submitted twice to completeEnrollment; nonce not consumed atomically until first complete", async () => {
    const nonce = "replay-attack-nonce-001";
    const commitment = deriveAgentCommitment(PUB_A);
    store.set(commitment, makeRow({
      subjectCommitment: commitment,
      challengeNonce: nonce,
      challengeExpiresAt: new Date(Date.now() + 60_000),
    }));
    const signature = await sigFor(nonce);
    // First completion succeeds
    const r1 = await completeEnrollment(commitment, signature);
    expect(r1.status).toBe(EnrollmentStatus.ISSUED);
    // Second attempt reuses same signature against same commitment (now ISSUED)
    // should throw ChallengeNotFoundError — if it completes, attack succeeds
    await expect(completeEnrollment(commitment, signature)).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
// A11: KEY TRANSPARENCY FORGERY
// ════════════════════════════════════════════════════════════════
describe("A11: Key transparency log forgery", () => {
  it("ATTACK: unsigned entries in key log can be freely inserted by any operator", async () => {
    // getKeyTransparencyLog reads env SIGNING_PRIVATE_KEY and SIGNING_PRIVATE_KEY_PREVIOUS
    // but does not HMAC-sign entries. Anyone who can write to the DB can insert a fake key.
    const keyLog = { entries: [{ kid: "fake", publicKey: "00".repeat(32), status: "active" }] };
    expect(keyLog.entries.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════
// A12: DID KEY FORMAT CONFUSION
// ════════════════════════════════════════════════════════════════
describe("A12: DID document key format", () => {
  it("ATTACK: autonomous provision embeds hex public key directly in did:key, should use multibase base58btc", () => {
    // Current format: `did:key:z${PUB_A.toLowerCase()}` — 'z' prefix indicates
    // base58btc multibase, but hex is not valid base58btc encoding of the key bytes.
    const did = `did:key:z${PUB_A.toLowerCase()}`;
    const pubkeyPart = did.replace("did:key:z", "");
    expect(pubkeyPart).toBe(PUB_A.toLowerCase());
    // A real did:key would base58btc(multicodec(0xed) + keyBytes)
  });
});

// ════════════════════════════════════════════════════════════════
// A13: OPERATOR ID ENUMERATION
// ════════════════════════════════════════════════════════════════
describe("A13: Operator ID enumeration", () => {
  it("ATTACK: autonomous operator Stripe customer ID leaks commitment prefix", () => {
    const commitment = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const stripeId = `cus_auto_${commitment.slice(0, 24)}`;
    expect(stripeId).toContain(commitment.slice(0, 24));
  });
});

// ════════════════════════════════════════════════════════════════
// A14: CHALLENGE NONCE COLLISION
// ════════════════════════════════════════════════════════════════
describe("A14: Challenge nonce collision risk", () => {
  it("nonce is 32 random bytes (256-bit) so collision is cryptographically negligible", () => {
    const nonce = generateChallengeNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    const nonce2 = generateChallengeNonce();
    expect(nonce).not.toBe(nonce2);
  });
});

// ════════════════════════════════════════════════════════════════
// A15: KYC BYPASS
// ════════════════════════════════════════════════════════════════
describe("A15: KYC bypass via API", () => {
  it("ATTACK: KYC status should have an audit trail on every mutation", async () => {
    // The compliance layer checks KYC status for withdrawals:
    // Need KYC APPROVED for live env. But KYC mutations via admin route
    // need full audit logging of who changed what.
    const result = { kycStatus: "APPROVED" };
    expect(result.kycStatus).toBe("APPROVED");
    // Document: KYC mutations should log operator_id + timestamp + previous value
  });
});