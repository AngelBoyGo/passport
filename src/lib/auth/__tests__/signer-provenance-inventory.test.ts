/**
 * Signer-provenance inventory meta-test (Phase 38).
 *
 * The audit found routes/services that verified a signature against a CALLER-SUPPLIED key
 * (self-asserted signer). That class is now fixed and centralized in
 * `verifyPinnedSignature`. This test makes the class non-regressable: every non-test source
 * file that calls `verify(` / `.verify(` directly must either
 *
 *   - delegate to `verifyPinnedSignature` (preferred), or
 *   - be listed in APPROVED_VERIFY_CALL_SITES with a justification.
 *
 * A new direct `verify(` call site therefore fails the suite by name.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const VERIFY_CALL = /\bverify\s*\(/;
const HELPER = "src/lib/auth/verifyPinnedSignature.ts";

/**
 * Existing direct Ed25519 verification call sites that do NOT (yet) use the pinned-provenance
 * helper. Each must justify why its key is not attacker-controlled, or flag residual risk.
 * Keep sorted. If you add a new `verify(` call, either use verifyPinnedSignature or add an
 * entry here with a reason.
 */
const APPROVED_VERIFY_CALL_SITES: Record<string, string> = {
  "src/lib/bill-of-rights/rights.ts": "rights manifest signature; signed by the issuing authority key; key embedded in manifest",
  "src/lib/bill-of-rights/violations.ts": "violation report signature; reporter key; key embedded in violation record",
  "src/lib/compliance/package-builder.ts": "compliance package receipt signature; operator signing key",
  "src/lib/credentials/portable-reputation.ts": "W3C VC signature; issuer key",
  "src/lib/enrollment/proof.ts": "enrollment challenge signature; low-level fn, verify is the final step in a PoW chain",
  "src/lib/notary/notary-anchor.ts": "external notary anchor signature",
  "src/lib/receipt/verify.ts": "public offline receipt verification; key embedded in the signed receipt",
  "src/lib/reserves/por-service.ts": "PoR attestation self-verification; public_key carried in the signed attestation",
  "src/lib/transparency/key-log.ts": "key-transparency log entry signature; key from the log",
  "src/lib/auth/autonomous-provision.ts": "PoW/signature provisioning; raw SHA-256 hash signing, not compatible with helper's utf-8 signPayload",
  "src/app/api/v1/a2a/hire/route.ts": "A2A hire signature; raw bytes signing over hash digest, not compatible with helper's utf-8 mode",
  "src/app/api/v1/delegation/route.ts": "delegation grant signature; raw message bytes, helper uses utf-8",
  "src/app/api/v1/messages/route.ts": "agent message signature; signed over hex-to-bytes digest, incompatible with utf-8 helper",
};

function findTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "tests") continue;
      findTsFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function rel(p: string): string {
  return relative(ROOT, p).split(sep).join("/");
}

describe("Signer provenance inventory (non-regressable)", () => {
  it("every direct verify() call site uses verifyPinnedSignature or is approved with a reason", () => {
    const unapproved: string[] = [];
    for (const file of findTsFiles(SRC)) {
      const r = rel(file);
      if (r === HELPER) continue;
      const src = readFileSync(file, "utf8");
      if (!VERIFY_CALL.test(src)) continue;
      if (src.includes("verifyPinnedSignature")) continue;
      if (!(r in APPROVED_VERIFY_CALL_SITES)) unapproved.push(r);
    }
    expect(
      unapproved,
      `Direct verify() without pinned provenance. Use verifyPinnedSignature or add an APPROVED entry: ${unapproved.join(", ")}`
    ).toEqual([]);
  });

  it("the approved list has no stale entries", () => {
    const stale: string[] = [];
    for (const r of Object.keys(APPROVED_VERIFY_CALL_SITES)) {
      const src = readFileSync(join(ROOT, r), "utf8");
      if (!VERIFY_CALL.test(src)) stale.push(r);
    }
    expect(stale, `Stale APPROVED_VERIFY_CALL_SITES entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("the audit's self-asserted signer paths and refactored call sites now delegate to verifyPinnedSignature", () => {
    const hardened = [
      "src/lib/reserves/threshold-quorum.ts",
      "src/lib/reserves/industrial-mining.ts",
      "src/lib/reserves/bonded-transit.ts",
      "src/lib/reserves/industrialization-fund.ts",
      "src/lib/swarm/swarm-service.ts",
      "src/lib/agent-economy/dispute.ts",
      "src/lib/agent-economy/conformance.ts",
      "src/lib/agent-economy/compute-marketplace.ts",
      "src/lib/agent-pay/agent-payment-service.ts",
      "src/lib/auth/authorize.ts",
      "src/lib/datacenter/datacenter-service.ts",
      "src/lib/logistics/customs-clearing.ts",
      "src/lib/raillab/attest.ts",
      "src/lib/raillab/breach-response.ts",
      "src/lib/raillab/settlement.ts",
      "src/lib/receipt/merkle-checkpoint.ts",
      "src/lib/reserves/artisanal-sourcing.ts",
    ];
    for (const r of hardened) {
      const src = readFileSync(join(ROOT, r), "utf8");
      expect(src, `${r} must use verifyPinnedSignature`).toContain("verifyPinnedSignature");
    }
  });
});
