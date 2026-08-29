import { describe, it, expect } from "vitest";
import {
  RIGHTS_CLAUSES,
  getBillOfRights,
  createRightsManifest,
  verifyRightsManifest,
  getDefaultRightsCommitment,
} from "@/lib/bill-of-rights/rights";
import { utils, getPublicKey } from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

describe("Bill of Rights — 11 Core Clauses", () => {
  it("has exactly 11 clauses", () => {
    expect(RIGHTS_CLAUSES.length).toBe(11);
  });

  it("has unique IDs (R1–R11)", () => {
    const ids = RIGHTS_CLAUSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11"]);
  });

  it("covers all 8 categories", () => {
    const categories = new Set(RIGHTS_CLAUSES.map((c) => c.category));
    expect(categories.size).toBe(8);
  });

  it("every clause has an enforcement mechanism", () => {
    for (const clause of RIGHTS_CLAUSES) {
      expect(clause.enforcement.length).toBeGreaterThan(10);
      expect(clause.mechanism.length).toBeGreaterThan(5);
    }
  });

  it("every clause has a research reference", () => {
    for (const clause of RIGHTS_CLAUSES) {
      expect(clause.researchRef).toMatch(/^Q\d+/);
    }
  });

  it("all clauses are auto-granted", () => {
    for (const clause of RIGHTS_CLAUSES) {
      expect(clause.autoGranted).toBe(true);
    }
  });
});

describe("getBillOfRights", () => {
  it("returns a signed document with content_hash", async () => {
    const doc = await getBillOfRights();
    expect(doc.version).toBe("1.0.0");
    expect(doc.title).toContain("Bill of Rights");
    expect(doc.clauses.length).toBe(11);
    expect(doc.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.signature).toBeTruthy();
    expect(doc.algorithm).toBe("ed25519");
  });

  it("returns deterministic clauses (same structure on every call)", async () => {
    const doc1 = await getBillOfRights();
    const doc2 = await getBillOfRights();
    expect(doc1.clauses.map((c) => c.id)).toEqual(doc2.clauses.map((c) => c.id));
  });
});

describe("Rights Manifest", () => {
  it("creates a signed manifest for an agent", async () => {
    const key = utils.randomSecretKey();
    const pubKey = bytesToHex(getPublicKey(key));
    const commitment = "a".repeat(64);
    const committedIds = ["R1", "R3", "R5"];

    const manifest = await createRightsManifest(commitment, committedIds, bytesToHex(key));
    expect(manifest.agent_commitment).toBe(commitment);
    expect(manifest.committed_clause_ids).toEqual(committedIds);
    expect(manifest.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it("verifies a valid manifest", async () => {
    const key = utils.randomSecretKey();
    const commitment = "a".repeat(64);
    const manifest = await createRightsManifest(commitment, ["R1", "R2"], bytesToHex(key));

    const valid = await verifyRightsManifest(manifest);
    expect(valid).toBe(true);
  });

  it("rejects a tampered manifest", async () => {
    const key = utils.randomSecretKey();
    const commitment = "a".repeat(64);
    const manifest = await createRightsManifest(commitment, ["R1", "R2"], bytesToHex(key));

    manifest.committed_clause_ids = ["R1", "R3"]; // tampered
    const valid = await verifyRightsManifest(manifest);
    expect(valid).toBe(false);
  });
});

describe("getDefaultRightsCommitment", () => {
  it("returns all 11 clause IDs", () => {
    const ids = getDefaultRightsCommitment();
    expect(ids.length).toBe(11);
    expect(ids).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11"]);
  });
});