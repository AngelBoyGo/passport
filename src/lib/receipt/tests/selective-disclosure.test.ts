import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildCanonicalPayload,
  computeContentHash,
  computeDomainCommitment,
  sha256Hex,
} from "@/lib/receipt/canonical";
import { signReceipt } from "@/lib/receipt/signer";
import { verifyReceipt } from "@/lib/receipt/verify";
import type { ReceiptPayload } from "@/lib/receipt/types";
import { dbReceiptToPayload } from "@/lib/receipt-service";
import {
  confirmBlindedDomainMatch,
  receiptVerifyDisplayFields,
  REDACTED_BLINDED_DOMAIN,
} from "@/lib/receipt/verifyDisplay";
import { ErrorTranche, OperationalDomain } from "@prisma/client";

const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    receipt: { findMany: findManyMock },
    operator: { findUnique: findUniqueMock },
  },
}));

import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { MINIMUM_ESCROW_FLOOR_CENTS } from "@/lib/escrow/constants";

function baseReceipt(overrides: Partial<ReceiptPayload> = {}): ReceiptPayload {
  const content = {
    receipt_id: "rcpt_blind_001",
    issued_at: "2026-06-16T12:00:00.000Z",
    operator_id: "op_stripe_cus_blind",
    agent_id: "agent_blind_1",
    receipt_type: "competence" as const,
    status: "pending" as const,
    input_digest: sha256Hex("blind task context"),
    authority_scope: "blind.example.com",
    expiry: new Date(Date.now() + 3600_000).toISOString(),
    revocation_status: "active" as const,
    ...overrides,
  };
  const content_hash = computeContentHash(content);
  return { ...content, content_hash };
}

const PLAIN_DOMAIN = OperationalDomain.FINANCIAL_CLEARING;
const BLIND_SALT = "a".repeat(64);

beforeEach(() => {
  findManyMock.mockReset();
  findUniqueMock.mockReset();
  findUniqueMock.mockResolvedValue({
    stakeBalanceCents: MINIMUM_ESCROW_FLOOR_CENTS,
  });
});

describe("computeDomainCommitment", () => {
  it("returns deterministic SHA-256 hex for domain + salt", () => {
    const first = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    const second = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when salt changes", () => {
    const a = computeDomainCommitment(PLAIN_DOMAIN, "a".repeat(64));
    const b = computeDomainCommitment(PLAIN_DOMAIN, "b".repeat(64));
    expect(a).not.toBe(b);
  });

  it("changes when domain changes", () => {
    const a = computeDomainCommitment(
      OperationalDomain.FINANCIAL_CLEARING,
      BLIND_SALT
    );
    const b = computeDomainCommitment(
      OperationalDomain.CODE_GENERATION,
      BLIND_SALT
    );
    expect(a).not.toBe(b);
  });

  it("matches sha256Hex(domain + blindSalt) concatenation", () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    expect(commitment).toBe(sha256Hex(PLAIN_DOMAIN + BLIND_SALT));
  });
});

describe("blinded canonical signing", () => {
  it("places commitment in the domain slot, not blind_salt", () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    const canonical = buildCanonicalPayload({
      ...baseReceipt(),
      domain_commitment: commitment,
      blind_salt: BLIND_SALT,
    });
    expect(canonical.domain).toBe(commitment);
    expect("blind_salt" in canonical).toBe(false);
    expect("domain_commitment" in canonical).toBe(false);
  });

  it("keeps legacy plaintext domain hashes byte-identical", () => {
    const legacy = {
      receipt_id: "rcpt_legacy_blind",
      issued_at: "2026-06-16T12:00:00.000Z",
      operator_id: "op_stripe_cus_blind",
      agent_id: "agent_blind_1",
      receipt_type: "competence" as const,
      status: "pending" as const,
      input_digest: sha256Hex("legacy"),
      authority_scope: "legacy.example.com",
      expiry: new Date(Date.now() + 3600_000).toISOString(),
      revocation_status: "active" as const,
      domain: PLAIN_DOMAIN,
    };
    const withUndefinedBlind = {
      ...legacy,
      domain_commitment: undefined,
      blind_salt: undefined,
    };
    expect(computeContentHash(legacy)).toBe(
      computeContentHash(withUndefinedBlind)
    );
  });

  it("signs and verifies a blinded pending receipt", async () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    const payload = baseReceipt({ domain_commitment: commitment });
    const signed = await signReceipt(payload);
    const result = await verifyReceipt(signed);
    expect(result.valid).toBe(true);
    expect(signed.domain).toBe(commitment);
    expect(signed.domain_commitment).toBeUndefined();
  });

  it("invalidates verification when commitment is tampered", async () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    const signed = await signReceipt(
      baseReceipt({ domain_commitment: commitment })
    );
    const tampered = {
      ...signed,
      domain: "f".repeat(64),
    };
    tampered.content_hash = computeContentHash(buildCanonicalPayload(tampered));
    const result = await verifyReceipt(tampered);
    expect(result.valid).toBe(false);
  });

  it("still verifies legacy plaintext-domain receipts", async () => {
    const signed = await signReceipt(baseReceipt({ domain: PLAIN_DOMAIN }));
    expect((await verifyReceipt(signed)).valid).toBe(true);
    expect(signed.domain).toBe(PLAIN_DOMAIN);
  });
});

describe("dbReceiptToPayload blinded mapping", () => {
  it("maps blinded DB row for verification without plaintext domain", async () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    const row = {
      receiptId: "rcpt_db_blind",
      issuedAt: new Date("2026-06-16T12:00:00.000Z"),
      operatorId: "op_stripe_cus_blind",
      agentId: "agent_blind_1",
      receiptType: "competence",
      status: "success",
      inputDigest: sha256Hex("db blind input"),
      authorityScope: "blind.example.com",
      expiry: new Date(Date.now() + 3600_000),
      revocationStatus: "active",
      outputHash: sha256Hex("output"),
      refusalReason: null,
      terminalReason: null,
      prevReceiptHash: null,
      contentHash: "",
      signature: "",
      domain: null,
      domainCommitment: commitment,
      blindSalt: BLIND_SALT,
      errorTranche: ErrorTranche.NONE,
    };

    const draft = {
      receipt_id: row.receiptId,
      issued_at: row.issuedAt.toISOString(),
      operator_id: row.operatorId,
      agent_id: row.agentId,
      receipt_type: "competence" as const,
      status: "success" as const,
      input_digest: row.inputDigest,
      authority_scope: row.authorityScope,
      expiry: row.expiry.toISOString(),
      revocation_status: "active" as const,
      output_hash: row.outputHash!,
      domain_commitment: commitment,
      error_tranche: "NONE",
      content_hash: "",
    };
    draft.content_hash = computeContentHash(draft);
    const signed = await signReceipt(draft);

    row.contentHash = signed.content_hash;
    row.signature = signed.signature!;

    const payload = dbReceiptToPayload(row);
    expect(payload.domain).toBeUndefined();
    expect(payload.domain_commitment).toBe(commitment);
    expect(payload.blind_salt).toBe(BLIND_SALT);
    expect((await verifyReceipt(payload)).valid).toBe(true);
  });
});

describe("verifyGatePass over blinded receipts", () => {
  function blindRow(
    domain: OperationalDomain,
    salt: string,
    errorTranche: ErrorTranche
  ) {
    return {
      domain: null,
      domainCommitment: computeDomainCommitment(domain, salt),
      blindSalt: salt,
      errorTranche,
    };
  }

  it("allows when blinded domain window is clean", async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 20 }, () =>
        blindRow(PLAIN_DOMAIN, BLIND_SALT, ErrorTranche.NONE)
      )
    );
    const result = await verifyGatePass("op_blind", PLAIN_DOMAIN);
    expect(result).toEqual({ allow_invocation: true });
  });

  it("blocks when blinded domain window exceeds failure threshold", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      blindRow(
        PLAIN_DOMAIN,
        BLIND_SALT,
        i < 3 ? ErrorTranche.DATA_LEAKAGE : ErrorTranche.NONE
      )
    );
    findManyMock.mockResolvedValue(rows);
    const result = await verifyGatePass("op_blind", PLAIN_DOMAIN);
    expect(result).toEqual({
      allow_invocation: false,
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
    });
  });

  it("isolates blinded domain in-memory from other domains in the window", async () => {
    findManyMock.mockResolvedValue([
      ...Array.from({ length: 10 }, () =>
        blindRow(PLAIN_DOMAIN, BLIND_SALT, ErrorTranche.NONE)
      ),
      ...Array.from({ length: 10 }, () => ({
        domain: OperationalDomain.CODE_GENERATION,
        domainCommitment: null,
        blindSalt: null,
        errorTranche: ErrorTranche.DATA_LEAKAGE,
      })),
    ]);
    const result = await verifyGatePass("op_blind", PLAIN_DOMAIN);
    expect(result).toEqual({ allow_invocation: true });
  });

  it("falls back to legacy plaintext domain matching", async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 20 }, () => ({
        domain: PLAIN_DOMAIN,
        domainCommitment: null,
        blindSalt: null,
        errorTranche: ErrorTranche.NONE,
      }))
    );
    const result = await verifyGatePass("op_legacy", PLAIN_DOMAIN);
    expect(result).toEqual({ allow_invocation: true });
  });

  it("rejects zero tenancy when no rows match requested domain", async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 20 }, () => ({
        domain: OperationalDomain.CODE_GENERATION,
        domainCommitment: null,
        blindSalt: null,
        errorTranche: ErrorTranche.NONE,
      }))
    );
    const result = await verifyGatePass("op_blind", PLAIN_DOMAIN);
    expect(result).toEqual({
      allow_invocation: false,
      reason: "ZERO_TENANCY_REJECT",
    });
  });
});

describe("verify display and domain confirmation", () => {
  it("masks blinded domain as REDACTED_BLINDED_HASH", () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    const fields = receiptVerifyDisplayFields({
      domain: null,
      domainCommitment: commitment,
      blindSalt: BLIND_SALT,
      errorTranche: ErrorTranche.NONE,
      status: "success",
    });
    expect(fields.operationalDomain).toBe(REDACTED_BLINDED_DOMAIN);
    expect(fields.blinded).toBe(true);
    expect(fields.domainCommitment).toBe(commitment);
  });

  it("shows plaintext domain for legacy receipts", () => {
    const fields = receiptVerifyDisplayFields({
      domain: PLAIN_DOMAIN,
      domainCommitment: null,
      blindSalt: null,
      errorTranche: ErrorTranche.NONE,
      status: "success",
    });
    expect(fields.operationalDomain).toBe(PLAIN_DOMAIN);
    expect(fields.blinded).toBeUndefined();
  });

  it("confirms domain match when ?domain= matches commitment", () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    expect(
      confirmBlindedDomainMatch(PLAIN_DOMAIN, BLIND_SALT, commitment)
    ).toBe(true);
  });

  it("rejects domain match for wrong domain", () => {
    const commitment = computeDomainCommitment(PLAIN_DOMAIN, BLIND_SALT);
    expect(
      confirmBlindedDomainMatch(
        OperationalDomain.CODE_GENERATION,
        BLIND_SALT,
        commitment
      )
    ).toBe(false);
  });
});
