import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEvidence: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  buildAuditEvidencePackage,
  getAuditFrameworks,
} from "@/lib/compliance/audit-evidence-package";
import { sha256Hex } from "@/lib/receipt/canonical";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { getPublicKeyHex } from "@/lib/receipt/signer";

describe("Audit-Grade Compliance Evidence Aggregation (2.5)", () => {
  const commitment = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  });

  it("exposes the supported audit frameworks and control sets", () => {
    const frameworks = getAuditFrameworks();
    expect(frameworks.map((f) => f.id)).toEqual(["SOC2_TYPE2", "ISO_27001", "ISO_42001"]);
    expect(frameworks[0].controls).toContain("CC6.1");
  });

  it("maps compliance_report receipts to real controls and computes a signed audit package", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([
      {
        id: "ev_1",
        sourceType: "compliance_report",
        observedAt: new Date("2026-08-01T00:00:00Z"),
        sourceDigest: JSON.stringify({ report: { id: "report-cc6-1" }, control_domain: "CC6.1" }),
      },
      {
        id: "ev_2",
        sourceType: "compliance_report",
        observedAt: new Date("2026-08-10T00:00:00Z"),
        sourceDigest: JSON.stringify({ report_id: "report-cc7-1", controls: [{ control_id: "CC7.1" }] }),
      },
    ]);

    const pkg = await buildAuditEvidencePackage(commitment, "SOC2_TYPE2");

    expect(pkg).not.toBeNull();
    expect(pkg!.framework).toBe("SOC2_TYPE2");
    expect(pkg!.evidence_events_analyzed).toBe(2);

    const cc6 = pkg!.controls.find((c) => c.control_id === "CC6.1");
    expect(cc6?.status).toBe("SATISFIED");
    expect(cc6?.evidence_count).toBe(1);
    expect(cc6?.evidence_references).toContain("report-cc6-1");

    const cc7 = pkg!.controls.find((c) => c.control_id === "CC7.1");
    expect(cc7?.status).toBe("SATISFIED");
    expect(cc7?.evidence_references).toContain("report-cc7-1");

    expect(pkg!.compliance_score).toBeGreaterThan(0);
    expect(pkg!.signature).toMatch(/^[0-9a-f]{128}$/i);

    // Independently verify the package signature
    const unsigned = {
      package_id: pkg!.package_id,
      generated_at: pkg!.generated_at,
      framework: pkg!.framework,
      agent_commitment_hash: pkg!.agent_commitment_hash,
      control_count: pkg!.control_count,
      satisfied_count: pkg!.satisfied_count,
      compliance_score: pkg!.compliance_score,
      controls: pkg!.controls,
      evidence_events_analyzed: pkg!.evidence_events_analyzed,
      audit_period_start: pkg!.audit_period_start,
      audit_period_end: pkg!.audit_period_end,
    };
    const recalcHash = sha256Hex(JSON.stringify(Object.keys(unsigned).sort().reduce((acc, k) => ((acc as any)[k] = (unsigned as any)[k], acc), {} as any)));
    expect(recalcHash).toBe(pkg!.content_hash);
    const valid = await verify(
      hexToBytes(pkg!.signature),
      utf8ToBytes(pkg!.content_hash),
      hexToBytes(getPublicKeyHex())
    );
    expect(valid).toBe(true);
  });

  it("returns null when there is no compliance_report evidence", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);
    const pkg = await buildAuditEvidencePackage(commitment, "ISO_27001");
    expect(pkg).toBeNull();
  });
});
