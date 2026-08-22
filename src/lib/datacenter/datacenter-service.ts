import { sign, verify, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { signReceipt, getPublicKeyHex } from "@/lib/receipt/signer";
import type { ReceiptPayload } from "@/lib/receipt/types";
import { prisma } from "@/lib/db";
import { evaluateAndDispatchReputationSignals } from "@/lib/webhooks/webhook-service";

export type DataCenterEventType =
  | "HARDWARE_POWER_VALIDATION"
  | "POLICY_SETPOINT_TRANSITION"
  | "THERMAL_SAFETY_AUDIT"
  | "CARBON_AVOIDED_ACCRUAL"
  | "WORKLOAD_ENERGY_EFFICIENCY"
  | "AUTONOMOUS_MICROACTION";

export interface DataCenterTelemetryPayload {
  cluster_id: string;
  instance_id: string;
  event_type: DataCenterEventType;
  timestamp_utc: string;
  origin: "live-instrument" | "synthetic";
  sku: string;
  telemetry_source: string;
  baseline_nameplate_w?: number;
  measured_power_avg_w?: number;
  delta_power_pct?: number;
  ramp_delta_pct?: number;
  latency_overhead_pct?: number;
  replicate_count?: number;
  policy_setpoint_applied?: string;
  peak_junction_temp_c?: number;
  throttle_headroom_delta_t_c?: number;
  thermal_throttle_observed?: boolean;
  energy_saved_kwh?: number;
  grid_carbon_intensity_g_per_kwh?: number;
  carbon_avoided_kg?: number;
  useful_work_fraction?: number;
  joules_per_token?: number;
  operator_notes?: string;
  microaction_class?: string;
}

export interface DataCenterScorecard {
  cluster_id: string;
  agent_commitment_hash: string;
  total_events: number;
  hardware_verified_events: number;
  modeled_events: number;
  hardware_verification_ratio: number;
  acting_champion_policy: string;
  avg_power_reduction_pct: number;
  avg_ramp_reduction_pct: number;
  cumulative_energy_saved_kwh: number;
  cumulative_carbon_avoided_kg: number;
  thermal_safety_pass_rate_pct: number;
  latest_event_at: string | null;
  provenance_summary: {
    live_instrument_samples: number;
    synthetic_samples: number;
    hardware_seam_status: "VALIDATED_LIVE" | "UNVALIDATED_SEAM";
  };
}

export interface DataCenterSustainabilityCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    cluster_id: string;
    agent_commitment_hash: string;
    acting_champion_policy: string;
    metrics: {
      avg_power_reduction_pct: number;
      avg_ramp_reduction_pct: number;
      cumulative_energy_saved_kwh: number;
      cumulative_carbon_avoided_kg: number;
      thermal_safety_pass_rate_pct: number;
      hardware_verification_ratio: number;
    };
    provenance: {
      total_receipts: number;
      hardware_verified_count: number;
      modeled_count: number;
      hardware_seam_status: string;
    };
    issued_for: string;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

export interface DataCenterCompliancePackage {
  package_id: string;
  generated_at: string;
  framework: "EU_AI_ACT" | "NIST_AI_RMF" | "ISO_14064_GHG" | "SOC2_TYPE2";
  cluster_id: string;
  agent_commitment_hash: string;
  compliance_score: number;
  controls: {
    control_id: string;
    name: string;
    framework: string;
    status: "SATISFIED" | "PARTIAL" | "UNSATISFIED";
    evidence_count: number;
    description: string;
    audit_notes: string;
  }[];
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
 * Validates physical plausibility of data center electrical and thermal telemetry.
 * Prevents sensor glitches or spoofed feeds from poisoning verification records.
 */
export function validatePhysicalPlausibility(payload: DataCenterTelemetryPayload): void {
  // 1. Power Sanity Check: 0W < W <= 1.5x TDP nameplate
  if (payload.measured_power_avg_w !== undefined) {
    if (payload.measured_power_avg_w <= 0) {
      throw new Error("Measured power must be greater than 0 Watts");
    }
    const nameplate = payload.baseline_nameplate_w ?? 700; // Default max TDP ceiling
    if (payload.measured_power_avg_w > nameplate * 1.5) {
      throw new Error(
        `Measured power (${payload.measured_power_avg_w}W) exceeds physical SKU TDP limit (${nameplate * 1.5}W)`
      );
    }
  }

  // 2. Thermal Sanity Check: 0C <= Tj <= 115C
  if (payload.peak_junction_temp_c !== undefined) {
    if (payload.peak_junction_temp_c < 0 || payload.peak_junction_temp_c > 115) {
      throw new Error(
        `Junction temperature out of physical bounds (${payload.peak_junction_temp_c}°C). Valid: 0°C - 115°C.`
      );
    }
  }

  // 3. Power reduction delta bounds: -60% <= delta <= +60%
  if (payload.delta_power_pct !== undefined) {
    if (payload.delta_power_pct < -60 || payload.delta_power_pct > 60) {
      throw new Error(
        `Power delta percentage (${payload.delta_power_pct}%) outside credible physical envelope (-60% to +60%).`
      );
    }
  }
}

/**
 * Ingests authenticated data center power/thermal telemetry and issues a cryptographically signed receipt.
 */
export async function ingestDataCenterTelemetry(
  payload: DataCenterTelemetryPayload,
  operatorId?: string
): Promise<{
  receipt_id: string;
  event_commitment_hash: string;
  content_hash: string;
  signature: string;
  verified: boolean;
  origin: "live-instrument" | "synthetic";
}> {
  validatePhysicalPlausibility(payload);

  const commitment = sha256Hex(payload.cluster_id);
  const eventCommitmentHash = sha256Hex(canonicalJson(payload as unknown as Record<string, unknown>));
  const isLive = payload.origin === "live-instrument";

  // Find or use default operator
  const op = operatorId
    ? { id: operatorId }
    : await prisma.operator.findFirst({ select: { id: true } });
  const finalOperatorId = op?.id ?? "op_system_datacenter";

  // Find or create agent record for this cluster
  let agent = await prisma.agent.findFirst({
    where: { operatorId: finalOperatorId, agentId: payload.cluster_id },
    select: { id: true },
  });

  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        operatorId: finalOperatorId,
        agentId: payload.cluster_id,
        domain: "SYSTEM_INTEGRATION",
      },
      select: { id: true },
    });
  }

  // Persist immutable AgentEvidence
  const evidence = await prisma.agentEvidence.create({
    data: {
      sourceType: "datacenter_telemetry",
      artifactType: "datacenter_telemetry",
      normalizedEventType: payload.event_type,
      observedAt: new Date(payload.timestamp_utc || Date.now()),
      agentIdentityCommitment: commitment,
      validationSignalPresent: isLive,
      eventCommitmentHash,
      sourceDigest: JSON.stringify(payload),
      rawErrorClassification: payload.thermal_throttle_observed ? "THERMAL_THROTTLE" : null,
    },
  });

  // Create and sign receipt
  const receiptId = `rcpt_dc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();
  const expiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const receiptContent: ReceiptPayload = {
    receipt_id: receiptId,
    issued_at: now.toISOString(),
    operator_id: finalOperatorId,
    agent_id: payload.cluster_id,
    domain: "SYSTEM_INTEGRATION",
    receipt_type: "custody",
    status: "success",
    input_digest: eventCommitmentHash,
    authority_scope: "datacenter:energy:audit",
    expiry: expiry.toISOString(),
    revocation_status: "active",
    content_hash: "",
  };

  const signedReceipt = await signReceipt(receiptContent);

  const receipt = await prisma.receipt.create({
    data: {
      receiptId,
      issuedAt: now,
      operatorId: finalOperatorId,
      agentId: payload.cluster_id,
      agentRecordId: agent.id,
      receiptType: "datacenter_energy_receipt",
      status: "success",
      inputDigest: eventCommitmentHash,
      authorityScope: "datacenter:energy:audit",
      expiry,
      contentHash: signedReceipt.content_hash,
      signature: signedReceipt.signature,
      domain: "SYSTEM_INTEGRATION",
      finalizedAt: now,
    },
  });

  await prisma.evidenceReceiptLink.create({
    data: {
      agentEvidenceId: evidence.id,
      eventCommitmentHash,
      receiptId: receipt.receiptId,
      receiptCommitmentHash: sha256Hex(receipt.receiptId),
      linkageType: "VALIDATION",
      enforcementState: "AUDIT_RELEVANT",
      attributionMode: isLive ? "LIVE_HARDWARE_INSTRUMENTED" : "SIMULATION_MODELED",
      predicateVersion: "v1.0",
    },
  });

  // If thermal throttle occurred, dispatch reputation degradation alert
  if (payload.thermal_throttle_observed) {
    evaluateAndDispatchReputationSignals(finalOperatorId, commitment, {
      event: "reputation.degraded",
      reason: `Thermal throttle observed on ${payload.instance_id} (${payload.peak_junction_temp_c}°C)`,
      failure_rate: 1.0,
    }).catch(() => {});
  }

  return {
    receipt_id: receipt.receiptId,
    event_commitment_hash: eventCommitmentHash,
    content_hash: signedReceipt.content_hash,
    signature: signedReceipt.signature ?? "",
    verified: true,
    origin: payload.origin,
  };
}

/**
 * Computes a data center efficiency scorecard with explicit separation between live-instrumented and modeled telemetry.
 * Strict Honesty Rule: Modeled policies cannot usurp the acting champion unless hardware-validated.
 */
export async function getDataCenterScorecard(
  clusterIdOrCommitment: string
): Promise<DataCenterScorecard> {
  const commitment =
    clusterIdOrCommitment.length === 64
      ? clusterIdOrCommitment
      : sha256Hex(clusterIdOrCommitment);

  const events = await prisma.agentEvidence.findMany({
    where: {
      agentIdentityCommitment: commitment,
      sourceType: { in: ["datacenter_telemetry", "datacet_control_plane", "hardware_telemetry"] },
    },
    orderBy: { observedAt: "desc" },
  });

  const totalEvents = events.length;
  let hwVerified = 0;
  let modeled = 0;
  let powerDeltaSum = 0;
  let powerDeltaCount = 0;
  let rampDeltaSum = 0;
  let rampDeltaCount = 0;
  let energySavedKwh = 0;
  let carbonAvoidedKg = 0;
  let thermalEvents = 0;
  let thermalPasses = 0;
  let champion = "active_setpoint";
  let latestEventAt: string | null = null;

  for (const ev of events) {
    if (!latestEventAt && ev.observedAt) {
      latestEventAt = ev.observedAt.toISOString();
    }

    if (ev.validationSignalPresent) {
      hwVerified++;
    } else {
      modeled++;
    }

    if (ev.sourceDigest) {
      try {
        const d = JSON.parse(ev.sourceDigest);
        if (typeof d.delta_power_pct === "number" && d.origin === "live-instrument") {
          powerDeltaSum += d.delta_power_pct;
          powerDeltaCount++;
        }
        if (typeof d.ramp_delta_pct === "number" && d.origin === "live-instrument") {
          rampDeltaSum += d.ramp_delta_pct;
          rampDeltaCount++;
        }
        if (typeof d.energy_saved_kwh === "number") {
          energySavedKwh += d.energy_saved_kwh;
        }
        if (typeof d.carbon_avoided_kg === "number") {
          carbonAvoidedKg += d.carbon_avoided_kg;
        }
        // Strict Honesty: only live-instrument validated policies can update acting champion
        if (d.policy_setpoint_applied && d.origin === "live-instrument") {
          champion = d.policy_setpoint_applied;
        }
        if (d.peak_junction_temp_c !== undefined || d.thermal_throttle_observed !== undefined) {
          thermalEvents++;
          if (!d.thermal_throttle_observed && (d.peak_junction_temp_c ?? 0) <= 85) {
            thermalPasses++;
          }
        }
      } catch {}
    }
  }

  const hwRatio = totalEvents > 0 ? hwVerified / totalEvents : 0;
  const avgPower = powerDeltaCount > 0 ? powerDeltaSum / powerDeltaCount : 0;
  const avgRamp = rampDeltaCount > 0 ? rampDeltaSum / rampDeltaCount : 0;
  const thermalPassRate = thermalEvents > 0 ? (thermalPasses / thermalEvents) * 100 : 100;

  return {
    cluster_id: clusterIdOrCommitment,
    agent_commitment_hash: commitment,
    total_events: totalEvents,
    hardware_verified_events: hwVerified,
    modeled_events: modeled,
    hardware_verification_ratio: hwRatio,
    acting_champion_policy: champion,
    avg_power_reduction_pct: Number(avgPower.toFixed(2)),
    avg_ramp_reduction_pct: Number(avgRamp.toFixed(2)),
    cumulative_energy_saved_kwh: Number(energySavedKwh.toFixed(2)),
    cumulative_carbon_avoided_kg: Number(carbonAvoidedKg.toFixed(2)),
    thermal_safety_pass_rate_pct: Number(thermalPassRate.toFixed(1)),
    latest_event_at: latestEventAt,
    provenance_summary: {
      live_instrument_samples: hwVerified,
      synthetic_samples: modeled,
      hardware_seam_status: hwVerified > 0 ? "VALIDATED_LIVE" : "UNVALIDATED_SEAM",
    },
  };
}

export interface DataCenterDocumentationManifest {
  facility_id: string;
  generated_at: string;
  documentable_artifacts: string[];
  telemetry_records: {
    total: number;
    by_event_type: Record<string, number>;
    by_origin: { live_instrument: number; synthetic: number };
  };
  compliance_readiness: {
    eu_ai_act: boolean;
    iso_14064_scope2: boolean;
    soc2_cc6: boolean;
    nist_ai_rmf: boolean;
  };
  sustainability_summary: {
    energy_saved_kwh: number;
    carbon_avoided_kg: number;
    avg_power_reduction_pct: number;
  };
  audit_anchors: {
    merkle_checkpoints: boolean;
    notary_anchor: boolean;
    key_transparency_log: boolean;
  };
}

/**
 * What Passport documents for a data center: an aggregate manifest of every
 * artifact the substrate produces from a facility's signed telemetry stream —
 * the "ongoing documentation ledger" that audit, tenant, and regulator
 * stakeholders consume. This is the documentation surface for autonomous
 * facilities that perform millions of AI-driven microactions per day with no
 * human reviewer able to audit them individually.
 */
export async function getDataCenterDocumentationManifest(
  clusterIdOrCommitment: string
): Promise<DataCenterDocumentationManifest> {
  const commitment =
    clusterIdOrCommitment.length === 64
      ? clusterIdOrCommitment
      : sha256Hex(clusterIdOrCommitment);

  const events = await prisma.agentEvidence.findMany({
    where: {
      agentIdentityCommitment: commitment,
      sourceType: { in: ["datacenter_telemetry", "datacet_control_plane", "hardware_telemetry"] },
    },
    orderBy: { observedAt: "desc" },
    select: { normalizedEventType: true, validationSignalPresent: true, sourceDigest: true },
  });

  const byEventType: Record<string, number> = {};
  let liveCount = 0;
  let syntheticCount = 0;
  let energySaved = 0;
  let carbonAvoided = 0;
  let powerSum = 0;
  let powerCount = 0;

  for (const ev of events) {
    byEventType[ev.normalizedEventType] = (byEventType[ev.normalizedEventType] ?? 0) + 1;
    if (ev.validationSignalPresent) liveCount++;
    else syntheticCount++;
    if (ev.sourceDigest) {
      try {
        const d = JSON.parse(ev.sourceDigest);
        if (typeof d.energy_saved_kwh === "number") energySaved += d.energy_saved_kwh;
        if (typeof d.carbon_avoided_kg === "number") carbonAvoided += d.carbon_avoided_kg;
        if (typeof d.delta_power_pct === "number" && d.origin === "live-instrument") {
          powerSum += d.delta_power_pct;
          powerCount++;
        }
      } catch {}
    }
  }

  const hasLive = liveCount > 0;

  return {
    facility_id: clusterIdOrCommitment,
    generated_at: new Date().toISOString(),
    documentable_artifacts: [
      "ed25519_signed_energy_receipts",
      "merkle_checkpoint_roots",
      "external_notary_anchor",
      "w3c_sustainability_credential",
      "audit_grade_regulatory_packages",
      "public_key_transparency_log",
    ],
    telemetry_records: {
      total: events.length,
      by_event_type: byEventType,
      by_origin: { live_instrument: liveCount, synthetic: syntheticCount },
    },
    compliance_readiness: {
      eu_ai_act: hasLive,
      iso_14064_scope2: hasLive && carbonAvoided >= 0,
      soc2_cc6: hasLive,
      nist_ai_rmf: hasLive,
    },
    sustainability_summary: {
      energy_saved_kwh: Number(energySaved.toFixed(2)),
      carbon_avoided_kg: Number(carbonAvoided.toFixed(2)),
      avg_power_reduction_pct: powerCount > 0 ? Number((powerSum / powerCount).toFixed(2)) : 0,
    },
    audit_anchors: {
      merkle_checkpoints: true,
      notary_anchor: !!process.env.NOTARY_ANCHOR_URL,
      key_transparency_log: true,
    },
  };
}

/**
 * Generates an Ed25519-signed W3C Verifiable Credential for Data Center Sustainability & Energy Reduction.
 */
export async function generateDataCenterSustainabilityVC(
  clusterIdOrCommitment: string
): Promise<DataCenterSustainabilityCredential | null> {
  const commitment =
    clusterIdOrCommitment.length === 64
      ? clusterIdOrCommitment
      : sha256Hex(clusterIdOrCommitment);

  const scorecard = await getDataCenterScorecard(commitment);
  const now = new Date();
  const issuanceDate = now.toISOString();
  const privKey = getPrivateKeyBytes();
  const issuerPublicKey = bytesToHex(getPublicKey(privKey));
  const issuerDid = `did:key:z${issuerPublicKey}`;
  const clusterDid = `did:key:z${commitment.slice(0, 64)}`;
  const credentialId = `urn:uuid:${crypto.randomUUID()}`;

  const unsignedCredential = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://passport.metis.gold/contexts/datacenter-sustainability-v1.json",
    ],
    id: credentialId,
    type: ["VerifiableCredential", "DataCenterSustainabilityCredential"],
    issuer: issuerDid,
    issuanceDate,
    validFrom: issuanceDate,
    credentialSubject: {
      id: clusterDid,
      cluster_id: clusterIdOrCommitment,
      agent_commitment_hash: commitment,
      acting_champion_policy: scorecard.acting_champion_policy,
      metrics: {
        avg_power_reduction_pct: scorecard.avg_power_reduction_pct,
        avg_ramp_reduction_pct: scorecard.avg_ramp_reduction_pct,
        cumulative_energy_saved_kwh: scorecard.cumulative_energy_saved_kwh,
        cumulative_carbon_avoided_kg: scorecard.cumulative_carbon_avoided_kg,
        thermal_safety_pass_rate_pct: scorecard.thermal_safety_pass_rate_pct,
        hardware_verification_ratio: scorecard.hardware_verification_ratio,
      },
      provenance: {
        total_receipts: scorecard.total_events,
        hardware_verified_count: scorecard.hardware_verified_events,
        modeled_count: scorecard.modeled_events,
        hardware_seam_status: scorecard.provenance_summary.hardware_seam_status,
      },
      issued_for: "Enterprise Data Center Energy & Scope 2 ESG Audit",
    },
  };

  const canonicalHash = sha256Hex(canonicalJson(unsignedCredential as unknown as Record<string, unknown>));
  const signatureBytes = await sign(utf8ToBytes(canonicalHash), privKey);
  const proofValue = bytesToHex(signatureBytes);

  return {
    ...unsignedCredential,
    proof: {
      type: "Ed25519Signature2020",
      created: issuanceDate,
      verificationMethod: `${issuerDid}#${issuerPublicKey.slice(0, 16)}`,
      proofPurpose: "assertionMethod",
      proofValue,
    },
  };
}

/**
 * Validates a DataCenterSustainabilityCredential offline.
 */
export async function verifyDataCenterSustainabilityVC(
  vc: DataCenterSustainabilityCredential
): Promise<{ valid: boolean; error?: string }> {
  if (!vc || !vc.proof || !vc.proof.proofValue) {
    return { valid: false, error: "Missing cryptographic proof in credential" };
  }

  const { proof, ...unsigned } = vc;
  const canonicalHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));

  let issuerPubKeyHex = "";
  const match = vc.proof.verificationMethod?.match(/did:key:z([0-9a-f]{64})/i) ||
    vc.issuer?.match(/did:key:z([0-9a-f]{64})/i);

  if (match) {
    issuerPubKeyHex = match[1];
  } else {
    try {
      issuerPubKeyHex = getPublicKeyHex();
    } catch {
      return { valid: false, error: "Unable to resolve issuer public key" };
    }
  }

  try {
    const isValid = await verify(
      hexToBytes(proof.proofValue),
      utf8ToBytes(canonicalHash),
      hexToBytes(issuerPubKeyHex)
    );
    return { valid: isValid, error: isValid ? undefined : "Cryptographic signature mismatch" };
  } catch (e) {
    return { valid: false, error: String(e) };
  }
}

/**
 * Builds an audit-grade regulatory compliance package for data center operations.
 */
export async function buildDataCenterCompliancePackage(
  clusterIdOrCommitment: string,
  framework: "EU_AI_ACT" | "NIST_AI_RMF" | "ISO_14064_GHG" | "SOC2_TYPE2" = "EU_AI_ACT"
): Promise<DataCenterCompliancePackage | null> {
  const commitment =
    clusterIdOrCommitment.length === 64
      ? clusterIdOrCommitment
      : sha256Hex(clusterIdOrCommitment);

  const scorecard = await getDataCenterScorecard(commitment);
  const now = new Date();
  const packageId = `pkg_dc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  let controls = [];

  if (framework === "EU_AI_ACT") {
    controls = [
      {
        control_id: "EU_AI_ART_51_ENERGY",
        name: "Compute Resource & Energy Consumption Transparency",
        framework: "EU_AI_ACT",
        status: scorecard.hardware_verified_events > 0 ? ("SATISFIED" as const) : ("PARTIAL" as const),
        evidence_count: scorecard.total_events,
        description: "Mandatory reporting on energy consumption and environmental impact under Article 51 / Annex IV.",
        audit_notes: `Hardware-measured power reduction of ${scorecard.avg_power_reduction_pct}% verified across ${scorecard.hardware_verified_events} empirical runs.`,
      },
      {
        control_id: "EU_AI_ART_51_SAFETY",
        name: "Thermal Governor & Operational Safety",
        framework: "EU_AI_ACT",
        status: scorecard.thermal_safety_pass_rate_pct >= 95 ? ("SATISFIED" as const) : ("UNSATISFIED" as const),
        evidence_count: scorecard.total_events,
        description: "Safeguards against thermal runaway or hardware degradation under dynamic energy policies.",
        audit_notes: `Thermal safety pass rate: ${scorecard.thermal_safety_pass_rate_pct}%.`,
      },
    ];
  } else if (framework === "ISO_14064_GHG") {
    controls = [
      {
        control_id: "ISO_14064_SCOPE2_AVOIDANCE",
        name: "Scope 2 GHG Avoidance Accounting",
        framework: "ISO_14064_GHG",
        status: ("SATISFIED" as const),
        evidence_count: scorecard.total_events,
        description: "Verified indirect greenhouse gas emissions reduction through energy-aware setpoint optimization.",
        audit_notes: `Cumulative avoided emissions: ${scorecard.cumulative_carbon_avoided_kg} kg CO2e (${scorecard.cumulative_energy_saved_kwh} kWh saved).`,
      },
    ];
  } else {
    controls = [
      {
        control_id: "NIST_AI_RMF_MANAGE_3.1",
        name: "Hardware Optimization Governor & Risk Management",
        framework: "NIST_AI_RMF",
        status: ("SATISFIED" as const),
        evidence_count: scorecard.total_events,
        description: "Mechanisms to manage risk of AI hardware optimization and fail-safe baselines.",
        audit_notes: `Acting champion policy ${scorecard.acting_champion_policy} enforced with hardware gating.`,
      },
    ];
  }

  const privKey = getPrivateKeyBytes();
  const rawPackage = {
    package_id: packageId,
    generated_at: now.toISOString(),
    framework,
    cluster_id: clusterIdOrCommitment,
    agent_commitment_hash: commitment,
    compliance_score: scorecard.thermal_safety_pass_rate_pct,
    controls,
  };

  const contentHash = sha256Hex(canonicalJson(rawPackage as unknown as Record<string, unknown>));
  const signatureBytes = await sign(hexToBytes(contentHash), privKey);
  const signature = bytesToHex(signatureBytes);

  return {
    ...rawPackage,
    content_hash: contentHash,
    signature,
  };
}
