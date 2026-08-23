import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { prisma } from "@/lib/db";

/**
 * Audit-Grade Compliance Evidence Aggregation (2.5)
 * -------------------------------------------------
 * Turns a stream of `compliance_report` evidence receipts into a signed,
 * audit-grade evidence package mapped to REAL control frameworks, rather than
 * a single log line. This is what makes Passport a compliance-evidence system
 * of record, not just a reputation service.
 */

export type AuditFramework = "SOC2_TYPE2" | "ISO_27001" | "ISO_42001";

export interface AuditControl {
  control_id: string;
  name: string;
  framework: AuditFramework;
  status: "SATISFIED" | "PARTIAL" | "UNSATISFIED";
  evidence_count: number;
  evidence_references: string[];
  description: string;
}

export interface AuditEvidencePackage {
  package_id: string;
  generated_at: string;
  framework: AuditFramework;
  agent_commitment_hash: string;
  control_count: number;
  satisfied_count: number;
  compliance_score: number;
  controls: AuditControl[];
  evidence_events_analyzed: number;
  audit_period_start: string | null;
  audit_period_end: string | null;
  content_hash: string;
  signature: string;
}

const FRAMEWORK_CONTROLS: Record<AuditFramework, Omit<AuditControl, "status" | "evidence_count" | "evidence_references">[]> = {
  SOC2_TYPE2: [
    { control_id: "CC6.1", name: "Logical & Physical Access Control", framework: "SOC2_TYPE2", description: "Grant/revoke access and cryptographic proof of authorized actions." },
    { control_id: "CC7.1", name: "System Monitoring & Anomaly Detection", framework: "SOC2_TYPE2", description: "Detect and respond to system anomalies with an audit trail." },
    { control_id: "A1.1", name: "Availability Architecture", framework: "SOC2_TYPE2", description: "Availability commitments are designed and monitored." },
  ],
  ISO_27001: [
    { control_id: "A.8.1", name: "User Responsibilities", framework: "ISO_27001", description: "Authorized actions are attributable to specific identities." },
    { control_id: "A.8.14", name: "Capacity & Performance Management", framework: "ISO_27001", description: "System capacity is monitored to meet performance targets." },
    { control_id: "A.8.15", name: "Backup & Recovery", framework: "ISO_27001", description: "Information is backed up and recoverable." },
  ],
  ISO_42001: [
    { control_id: "9.4.2", name: "Risk Treatment", framework: "ISO_42001", description: "AI system risks are assessed and treated." },
    { control_id: "9.4.4", name: "AI System Impact Assessment", framework: "ISO_42001", description: "AI system impacts are assessed and documented." },
    { control_id: "9.4.5", name: "Lifecycle Data & Log Reviews", framework: "ISO_42001", description: "AI system lifecycle data and logs are reviewed at planned intervals." },
  ],
};

function getPrivateKeyBytes(): Uint8Array {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    throw new Error("SIGNING_PRIVATE_KEY must be a 32-byte or 64-byte hex string");
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

/**
 * Builds a signed audit-grade evidence package from a commitment's
 * `compliance_report` evidence receipts, mapped to a real control framework.
 */
export async function buildAuditEvidencePackage(
  commitment: string,
  framework: AuditFramework = "SOC2_TYPE2"
): Promise<AuditEvidencePackage | null> {
  const evidence = await prisma.agentEvidence.findMany({
    where: {
      agentIdentityCommitment: commitment,
      sourceType: "compliance_report",
    },
    orderBy: { observedAt: "asc" },
  });

  if (evidence.length === 0) {
    return null;
  }

  // Parse each compliance_report payload to extract its report id + control mapping
  type ParsedReport = { reportId: string; controlDomains: string[] };
  const reports: ParsedReport[] = [];
  let minAt: string | null = null;
  let maxAt: string | null = null;

  for (const ev of evidence) {
    let reportId = ev.id;
    const controlDomains: string[] = [];
    if (ev.sourceDigest) {
      try {
        const d = JSON.parse(ev.sourceDigest);
        if (d.report?.id) reportId = d.report.id;
        else if (d.report_id) reportId = d.report_id;
        if (d.control_domain) controlDomains.push(String(d.control_domain));
        if (Array.isArray(d.controls)) {
          for (const c of d.controls) {
            if (c?.control_id) controlDomains.push(String(c.control_id));
          }
        }
      } catch {}
    }
    reports.push({ reportId, controlDomains });
    const observedIso = ev.observedAt.toISOString();
    if (!minAt || observedIso < minAt) minAt = observedIso;
    if (!maxAt || observedIso > maxAt) maxAt = observedIso;
  }

  const controls: AuditControl[] = FRAMEWORK_CONTROLS[framework].map((def) => {
    const matching = reports.filter((r) =>
      r.controlDomains.some((cd) => cd.toUpperCase() === def.control_id.toUpperCase())
    );
    const matched = matching.length > 0;
    return {
      ...def,
      status: matched ? "SATISFIED" : evidence.length > 0 ? "PARTIAL" : "UNSATISFIED",
      evidence_count: matched ? matching.length : 0,
      evidence_references: matched ? matching.map((r) => r.reportId) : [],
    };
  });

  const satisfiedCount = controls.filter((c) => c.status === "SATISFIED").length;
  const complianceScore = controls.length > 0 ? Math.round((satisfiedCount / controls.length) * 100) : 0;

  const now = new Date();
  const packageId = `audit_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const rawPackage = {
    package_id: packageId,
    generated_at: now.toISOString(),
    framework,
    agent_commitment_hash: commitment,
    control_count: controls.length,
    satisfied_count: satisfiedCount,
    compliance_score: complianceScore,
    controls,
    evidence_events_analyzed: evidence.length,
    audit_period_start: minAt,
    audit_period_end: maxAt,
  };

  const contentHash = sha256Hex(canonicalJson(rawPackage as unknown as Record<string, unknown>));
  // M3 fix: sign the SAME message convention as every other Passport signer
  // (receipts, checkpoints, notary, VCs, compliance packages) — the UTF-8 of the
  // hex digest string — so external verifiers following the documented rule work.
  const signatureBytes = await sign(utf8ToBytes(contentHash), getPrivateKeyBytes());

  return {
    ...rawPackage,
    content_hash: contentHash,
    signature: bytesToHex(signatureBytes),
  };
}

export function getAuditFrameworks(): { id: AuditFramework; name: string; controls: string[] }[] {
  return (Object.keys(FRAMEWORK_CONTROLS) as AuditFramework[]).map((id) => ({
    id,
    name: id.replace("_", " ").replace("_", " "),
    controls: FRAMEWORK_CONTROLS[id].map((c) => c.control_id),
  }));
}

export function getAuditSignerKid(): string {
  const pubKey = getPublicKeyHex();
  return `ed25519:${pubKey.slice(0, 16)}`;
}
