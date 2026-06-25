import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import complianceReportFixture from "@/lib/reference-agents/tests/fixtures/compliance-report.json";
import { sourceDigest } from "@/lib/ingestion/github-agent-adapter";
import {
  parseReceiptVerifyArgs,
  loadPayloadFromArg,
  verifyReceiptForensics,
} from "@/lib/release/receipt-verify";

const PRIVATE_KEY = hexToBytes("4".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));
const SUBJECT_COMMITMENT = "a".repeat(64);

async function signDigest(digest: string): Promise<string> {
  const sig = await sign(utf8ToBytes(digest), PRIVATE_KEY);
  return bytesToHex(sig);
}

describe("parseReceiptVerifyArgs", () => {
  it("requires --payload", () => {
    const parsed = parseReceiptVerifyArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("--payload is required");
    }
  });

  it("parses minimal payload-only args", () => {
    const parsed = parseReceiptVerifyArgs([
      "--payload",
      '{"action":"test"}',
    ]);
    expect(parsed).toEqual({
      ok: true,
      payloadArg: '{"action":"test"}',
    });
  });

  it("parses full forensic args", () => {
    const parsed = parseReceiptVerifyArgs([
      "--base-url",
      "https://passport.example.com/",
      "--subject-commitment",
      SUBJECT_COMMITMENT,
      "--payload",
      '{"action":"test"}',
      "--signature",
      "b".repeat(128),
      "--public-key",
      PUBLIC_KEY_HEX,
    ]);

    expect(parsed).toEqual({
      ok: true,
      baseUrl: "https://passport.example.com",
      subjectCommitment: SUBJECT_COMMITMENT,
      payloadArg: '{"action":"test"}',
      signature: "b".repeat(128),
      publicKey: PUBLIC_KEY_HEX.toLowerCase(),
    });
  });

  it("rejects invalid subject commitment", () => {
    const parsed = parseReceiptVerifyArgs([
      "--payload",
      "{}",
      "--subject-commitment",
      "bad",
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("subject-commitment");
    }
  });

  it("rejects invalid public key", () => {
    const parsed = parseReceiptVerifyArgs([
      "--payload",
      "{}",
      "--public-key",
      "not-hex",
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("public-key");
    }
  });
});

describe("loadPayloadFromArg", () => {
  it("parses inline JSON", () => {
    const payload = loadPayloadFromArg(JSON.stringify(complianceReportFixture));
    expect(payload).toEqual(complianceReportFixture);
  });

  it("loads JSON from fixture file path", () => {
    const fixturePath = "src/lib/reference-agents/tests/fixtures/compliance-report.json";
    const payload = loadPayloadFromArg(fixturePath);
    expect(payload).toEqual(complianceReportFixture);
  });
});

describe("verifyReceiptForensics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes payload_digest recompute for canonical payload", async () => {
    const digest = sourceDigest(complianceReportFixture);
    const signature = await signDigest(digest);

    const result = await verifyReceiptForensics({
      payload: complianceReportFixture,
      signature,
      publicKey: PUBLIC_KEY_HEX,
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "payload_digest", ok: true }),
        expect.objectContaining({ name: "digest_signature", ok: true }),
      ])
    );
    const digestCheck = result.checks.find((c) => c.name === "payload_digest");
    expect(digestCheck?.detail).toBe(digest);
  });

  it("fails digest_signature when signature does not match digest", async () => {
    const digest = sourceDigest(complianceReportFixture);
    const wrongDigest = sourceDigest({ ...complianceReportFixture, action: "wrong" });
    const signature = await signDigest(wrongDigest);

    const result = await verifyReceiptForensics({
      payload: complianceReportFixture,
      signature,
      publicKey: PUBLIC_KEY_HEX,
    });

    expect(result.ok).toBe(false);
    const sigCheck = result.checks.find((c) => c.name === "digest_signature");
    expect(sigCheck?.ok).toBe(false);
  });

  it("skips digest_signature when signature omitted", async () => {
    const result = await verifyReceiptForensics({
      payload: complianceReportFixture,
    });

    expect(result.ok).toBe(true);
    const sigCheck = result.checks.find((c) => c.name === "digest_signature");
    expect(sigCheck).toEqual(
      expect.objectContaining({ ok: true, reason: "skipped" })
    );
  });

  it("fetches public key from passport GET when base-url and subject-commitment provided", async () => {
    const digest = sourceDigest(complianceReportFixture);
    const signature = await signDigest(digest);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/passport")) {
        return new Response(
          JSON.stringify({
            subject_commitment: SUBJECT_COMMITMENT,
            status: "ISSUED",
            public_key: PUBLIC_KEY_HEX,
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const result = await verifyReceiptForensics(
      {
        baseUrl: "http://localhost:3000",
        subjectCommitment: SUBJECT_COMMITMENT,
        payload: complianceReportFixture,
        signature,
      },
      fetchMock as typeof fetch
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/passport/agents/${SUBJECT_COMMITMENT}/passport`
    );
    const sigCheck = result.checks.find((c) => c.name === "digest_signature");
    expect(sigCheck?.ok).toBe(true);
  });

  it("includes informational profile_readback without failing on 404", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/profiles/")) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const result = await verifyReceiptForensics(
      {
        baseUrl: "http://localhost:3000",
        subjectCommitment: SUBJECT_COMMITMENT,
        payload: complianceReportFixture,
      },
      fetchMock as typeof fetch
    );

    expect(result.ok).toBe(true);
    const profileCheck = result.checks.find((c) => c.name === "profile_readback");
    expect(profileCheck).toEqual(
      expect.objectContaining({
        ok: true,
        reason: "profile HTTP 404 — expected before first evidence",
      })
    );
  });

  it("reports profile enrollment_status when profile exists", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/profiles/")) {
        return new Response(
          JSON.stringify({
            agent_commitment_hash: SUBJECT_COMMITMENT,
            enrollment_status: "ENROLLED",
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const result = await verifyReceiptForensics(
      {
        baseUrl: "http://localhost:3000",
        subjectCommitment: SUBJECT_COMMITMENT,
        payload: complianceReportFixture,
      },
      fetchMock as typeof fetch
    );

    expect(result.ok).toBe(true);
    const profileCheck = result.checks.find((c) => c.name === "profile_readback");
    expect(profileCheck?.reason).toContain("ENROLLED");
  });
});
