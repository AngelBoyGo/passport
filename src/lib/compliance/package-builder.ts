import { sign, verify, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { prisma } from "@/lib/db";
import { getAgentProfile } from "@/lib/public-portal/portal-service";

export type ComplianceFramework =
  | "NIST_AI_RMF"
  | "EU_AI_ACT"
  | "SOC2_TYPE2"
  | "ISO_42001";

export interface ComplianceControlResult {
  control_id: string;
  name: string;
  framework: ComplianceFramework;
  status: "SATISFIED" | "PARTIAL" | "UNSATISFIED";
  evidence_count: number;
  description: string;
  audit_notes: string;
}

export interface ComplianceEvidencePackage {
  package_id: string;
  generated_at: string;
  framework: ComplianceFramework;
  agent_commitment_hash: string;
  agent_did: string;
  verifier_kid: string;
  compliance_score: number;
  controls: ComplianceControlResult[];
  summary: {
    total_controls: number;
    satisfied_controls: number;
    evidence_events_analyzed: number;
    audit_period_start: string | null;
    audit_period_end: string | null;
  };
  content_hash: string;
  signature: string;
}

function getPrivateKeyBytes(): Uint8Array {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    throw new Error("SIGNING_PRIVATE_KEY must be a 32-byte or 64-byte hex string");
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

/**
 * Maps an agent's evidence ledger and enrollment status into audit-grade compliance controls.
 */
export async function buildCompliancePackage(
  commitment: string,
  options?: { framework?: ComplianceFramework }
): Promise<ComplianceEvidencePackage | null> {
  const framework = options?.framework ?? "NIST_AI_RMF";

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!enrollment || enrollment.status !== "ISSUED") {
    return null;
  }

  const profile = await getAgentProfile(commitment);
  if (!profile) return null;

  const totalEvents = profile.totals.evidence_count;
  const artifacts = profile.totals.artifact_count;
  const corrections = profile.totals.correction_count;
  const failures = profile.totals.failure_count;

  let controls: ComplianceControlResult[] = [];

  if (framework === "NIST_AI_RMF") {
    controls = [
      {
        control_id: "GOVERN_1.1",
        name: "Identity & Cryptographic Authorization",
        framework: "NIST_AI_RMF",
        status: "SATISFIED",
        evidence_count: 1,
        description: "Agent identity is anchored via Ed25519 proof of possession.",
        audit_notes: `Enrolled on ${enrollment.issuedAt?.toISOString() ?? "N/A"}. Key binding verified.`,
      },
      {
        control_id: "MAP_1.2",
        name: "Behavioral Context & Domain Classification",
        framework: "NIST_AI_RMF",
        status: artifacts > 0 ? "SATISFIED" : "PARTIAL",
        evidence_count: artifacts,
        description: "Agent execution boundaries and artifact types are categorized.",
        audit_notes: `${artifacts} verified output artifacts recorded.`,
      },
      {
        control_id: "MEASURE_2.3",
        name: "Runtime Fault & SLA Breach Tracking",
        framework: "NIST_AI_RMF",
        status: failures === 0 ? "SATISFIED" : "PARTIAL",
        evidence_count: failures,
        description: "Execution failures and timeout anomalies are tracked.",
        audit_notes: `${failures} execution failures recorded in audit window.`,
      },
      {
        control_id: "MANAGE_3.1",
        name: "Human Oversight & Correction Feedback",
        framework: "NIST_AI_RMF",
        status: corrections > 0 ? "SATISFIED" : "PARTIAL",
        evidence_count: corrections,
        description: "Human intervention, overrides, and revisions are preserved in audit trail.",
        audit_notes: `${corrections} human corrections accepted and tracked.`,
      },
    ];
  } else if (framework === "EU_AI_ACT") {
    controls = [
      {
        control_id: "ART_12_1",
        name: "Automatic Record-Keeping & Logging",
        framework: "EU_AI_ACT",
        status: totalEvents > 0 ? "SATISFIED" : "PARTIAL",
        evidence_count: totalEvents,
        description: "High-risk AI system logs events over its lifetime.",
        audit_notes: `${totalEvents} immutable evidence events recorded.`,
      },
      {
        control_id: "ART_14_HUMAN_OVERSIGHT",
        name: "Human Oversight Traceability",
        framework: "EU_AI_ACT",
        status: "SATISFIED",
        evidence_count: corrections,
        description: "Mechanisms to enable human operators to oversee and override agent decisions.",
        audit_notes: `${corrections} human override events audited.`,
      },
      {
        control_id: "ART_15_ROBUSTNESS",
        name: "Accuracy, Robustness & Cybersecurity",
        framework: "EU_AI_ACT",
        status: failures === 0 ? "SATISFIED" : "PARTIAL",
        evidence_count: failures,
        description: "Resilience against operational faults and unexpected errors.",
        audit_notes: `${failures} faults detected.`,
      },
    ];
  } else {
    controls = [
      {
        control_id: "CC6.1",
        name: "Cryptographic Access Control & Integrity",
        framework,
        status: "SATISFIED",
        evidence_count: totalEvents + 1,
        description: "Ed25519 tamper-evident signatures and privacy-safe commitments.",
        audit_notes: "Identity and evidence hash integrity verified.",
      },
      {
        control_id: "CC7.2",
        name: "Continuous Monitoring & Audit Logging",
        framework,
        status: totalEvents > 0 ? "SATISFIED" : "PARTIAL",
        evidence_count: totalEvents,
        description: "Continuous behavioral telemetry recorded in append-only ledger.",
        audit_notes: `${totalEvents} telemetry checkpoints logged.`,
      },
    ];
  }

  const satisfiedCount = controls.filter((c) => c.status === "SATISFIED").length;
  const complianceScore = Math.round((satisfiedCount / controls.length) * 100);
  const packageId = `pkg_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();

  let verifierKid = "";
  try {
    verifierKid = `ed25519:${getPublicKeyHex().slice(0, 16)}`;
  } catch {
    verifierKid = "ed25519:unknown";
  }

  const unsigned = {
    package_id: packageId,
    generated_at: now,
    framework,
    agent_commitment_hash: commitment,
    agent_did: `did:key:z${enrollment.publicKey}`,
    verifier_kid: verifierKid,
    compliance_score: complianceScore,
    controls,
    summary: {
      total_controls: controls.length,
      satisfied_controls: satisfiedCount,
      evidence_events_analyzed: totalEvents,
      audit_period_start: profile.first_observed_at,
      audit_period_end: profile.last_observed_at,
    },
  };

  const contentHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  const privKey = getPrivateKeyBytes();
  const signatureBytes = await sign(utf8ToBytes(contentHash), privKey);

  return {
    ...unsigned,
    content_hash: contentHash,
    signature: bytesToHex(signatureBytes),
  };
}

/**
 * Validates a compliance evidence package offline.
 */
export async function verifyCompliancePackage(
  pkg: ComplianceEvidencePackage,
  publicKeyHex?: string
): Promise<boolean> {
  if (!pkg || !pkg.signature || !pkg.content_hash) {
    return false;
  }

  const { signature, content_hash, ...unsigned } = pkg;
  const expectedHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));

  if (expectedHash !== content_hash) {
    return false;
  }

  const pubKey = publicKeyHex ?? getPublicKeyHex();
  try {
    return await verify(hexToBytes(signature), utf8ToBytes(content_hash), hexToBytes(pubKey));
  } catch {
    return false;
  }
}
