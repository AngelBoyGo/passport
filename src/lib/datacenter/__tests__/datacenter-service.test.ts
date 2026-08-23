import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn(), upsert: vi.fn() },
    agentEvidence: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    receipt: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    evidenceReceiptLink: { create: vi.fn() },
    operator: { findFirst: vi.fn() },
    agent: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  ingestDataCenterTelemetry,
  getDataCenterScorecard,
  generateDataCenterSustainabilityVC,
  verifyDataCenterSustainabilityVC,
  buildDataCenterCompliancePackage,
  validatePhysicalPlausibility,
  type DataCenterTelemetryPayload,
} from "@/lib/datacenter/datacenter-service";

describe("DataCenter Energy & Infrastructure Governance Domain", () => {
  const clusterId = "facility-cluster-01";
  const clusterCommitment = "c".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  describe("Physical Plausibility Verification", () => {
    it("accepts valid hardware telemetry within physical bounds", () => {
      const validPayload: DataCenterTelemetryPayload = {
        cluster_id: clusterId,
        instance_id: "gpu-node-01",
        event_type: "HARDWARE_POWER_VALIDATION",
        timestamp_utc: "2026-08-21T05:00:00Z",
        origin: "live-instrument",
        sku: "NVIDIA_H100_SXM5",
        telemetry_source: "nvml_v12.2_ipmi",
        baseline_nameplate_w: 700,
        measured_power_avg_w: 630.0,
        delta_power_pct: -10.0,
        ramp_delta_pct: -15.0,
        latency_overhead_pct: 1.5,
        replicate_count: 5,
        peak_junction_temp_c: 65.0,
      };

      expect(() => validatePhysicalPlausibility(validPayload)).not.toThrow();
    });

    it("rejects absurd power readings outside physical hardware TDP limits", () => {
      const absurdPowerPayload: DataCenterTelemetryPayload = {
        cluster_id: clusterId,
        instance_id: "gpu-node-01",
        event_type: "HARDWARE_POWER_VALIDATION",
        timestamp_utc: "2026-08-21T05:00:00Z",
        origin: "live-instrument",
        sku: "NVIDIA_H100_SXM5",
        telemetry_source: "nvml_v12.2",
        baseline_nameplate_w: 700,
        measured_power_avg_w: 99999, // Impossible > 1.5x TDP
        delta_power_pct: -10.0,
      };

      expect(() => validatePhysicalPlausibility(absurdPowerPayload)).toThrow(
        /exceeds physical SKU TDP limit/i
      );
    });

    it("rejects invalid thermal junction readings", () => {
      const absurdTempPayload: DataCenterTelemetryPayload = {
        cluster_id: clusterId,
        instance_id: "gpu-node-01",
        event_type: "THERMAL_SAFETY_AUDIT",
        timestamp_utc: "2026-08-21T05:00:00Z",
        origin: "live-instrument",
        sku: "NVIDIA_H100_SXM5",
        telemetry_source: "nvml_v12.2",
        peak_junction_temp_c: 150, // Out of physical bounds
      };

      expect(() => validatePhysicalPlausibility(absurdTempPayload)).toThrow(
        /junction temperature out of physical bounds/i
      );
    });
  });

  describe("Telemetry Ingestion & Receipt Issuance", () => {
    it("ingests live hardware telemetry, issues signed receipt, and links evidence", async () => {
      prismaMock.operator.findFirst.mockResolvedValue({ id: "op_default", stripeCustomerId: "cus_default" });
      prismaMock.agent.findFirst.mockResolvedValue({ id: "agent_rec_01" });
      prismaMock.agentEvidence.create.mockResolvedValue({
        id: "ev_01",
        eventCommitmentHash: "hash123",
      });
      prismaMock.receipt.create.mockResolvedValue({
        id: "rcpt_01",
        receiptId: "rcpt_datacenter_01",
        signature: "sig123",
      });
      prismaMock.evidenceReceiptLink.create.mockResolvedValue({ id: "link_01" });

      const payload: DataCenterTelemetryPayload = {
        cluster_id: clusterId,
        instance_id: "gpu-node-01",
        event_type: "HARDWARE_POWER_VALIDATION",
        timestamp_utc: "2026-08-21T05:00:00Z",
        origin: "live-instrument",
        sku: "NVIDIA_H100_SXM5",
        telemetry_source: "nvml_v12.2",
        baseline_nameplate_w: 700,
        measured_power_avg_w: 630.0,
        delta_power_pct: -10.0,
        ramp_delta_pct: -15.0,
        latency_overhead_pct: 1.5,
        replicate_count: 5,
        policy_setpoint_applied: "power_governor_v2",
        peak_junction_temp_c: 65.0,
      };

      const result = await ingestDataCenterTelemetry(payload);

      expect(result.verified).toBe(true);
      expect(result.origin).toBe("live-instrument");
      expect(result.receipt_id).toBeDefined();
      expect(result.event_commitment_hash).toMatch(/^[0-9a-f]{64}$/i);
      expect(result.signature).toBeDefined();
      expect(prismaMock.agentEvidence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "datacenter_telemetry",
            validationSignalPresent: true,
          }),
        })
      );
    });
  });

  describe("DataCenter Scorecard & Transparency Radar", () => {
    it("computes accurate scorecard distinguishing hardware-verified vs modeled telemetry", async () => {
      prismaMock.agentEvidence.findMany.mockResolvedValue([
        {
          id: "ev_1",
          sourceType: "datacenter_telemetry",
          normalizedEventType: "HARDWARE_POWER_VALIDATION",
          validationSignalPresent: true,
          observedAt: new Date("2026-08-21T04:00:00Z"),
          sourceDigest: JSON.stringify({
            origin: "live-instrument",
            delta_power_pct: -10.0,
            ramp_delta_pct: -15.0,
            policy_setpoint_applied: "power_governor_v2",
            peak_junction_temp_c: 65.0,
            thermal_throttle_observed: false,
          }),
        },
        {
          id: "ev_2",
          sourceType: "datacenter_telemetry",
          normalizedEventType: "CARBON_AVOIDED_ACCRUAL",
          validationSignalPresent: true,
          observedAt: new Date("2026-08-21T04:30:00Z"),
          sourceDigest: JSON.stringify({
            origin: "live-instrument",
            energy_saved_kwh: 12.5,
            carbon_avoided_kg: 4.8,
          }),
        },
        {
          id: "ev_3",
          sourceType: "datacenter_telemetry",
          normalizedEventType: "HARDWARE_POWER_VALIDATION",
          validationSignalPresent: false,
          observedAt: new Date("2026-08-21T04:45:00Z"),
          sourceDigest: JSON.stringify({
            origin: "synthetic",
            delta_power_pct: -12.18,
            policy_setpoint_applied: "sim_model_01",
          }),
        },
      ]);

      const scorecard = await getDataCenterScorecard(clusterCommitment);

      expect(scorecard.total_events).toBe(3);
      expect(scorecard.hardware_verified_events).toBe(2);
      expect(scorecard.modeled_events).toBe(1);
      expect(scorecard.hardware_verification_ratio).toBeCloseTo(0.67, 1);
      expect(scorecard.acting_champion_policy).toBe("power_governor_v2");
      expect(scorecard.avg_power_reduction_pct).toBe(-10.0);
      expect(scorecard.cumulative_energy_saved_kwh).toBe(12.5);
      expect(scorecard.cumulative_carbon_avoided_kg).toBe(4.8);
      expect(scorecard.thermal_safety_pass_rate_pct).toBe(100);
      expect(scorecard.provenance_summary.hardware_seam_status).toBe("VALIDATED_LIVE");
    });
  });

  describe("W3C Data Center Sustainability Verifiable Credential", () => {
    it("issues and cryptographically signs a W3C DataCenterSustainabilityCredential", async () => {
      prismaMock.agentEvidence.findMany.mockResolvedValue([
        {
          id: "ev_1",
          sourceType: "datacenter_telemetry",
          normalizedEventType: "HARDWARE_POWER_VALIDATION",
          validationSignalPresent: true,
          observedAt: new Date("2026-08-21T04:00:00Z"),
          sourceDigest: JSON.stringify({
            origin: "live-instrument",
            delta_power_pct: -10.0,
            policy_setpoint_applied: "power_governor_v2",
            energy_saved_kwh: 50.0,
            carbon_avoided_kg: 18.2,
            thermal_throttle_observed: false,
          }),
        },
      ]);

      const vc = await generateDataCenterSustainabilityVC(clusterCommitment);

      expect(vc).not.toBeNull();
      expect(vc!["@context"]).toContain("https://www.w3.org/ns/credentials/v2");
      expect(vc!.type).toContain("DataCenterSustainabilityCredential");
      expect(vc!.credentialSubject.acting_champion_policy).toBe("power_governor_v2");
      expect(vc!.proof.type).toBe("Ed25519Signature2020");
      expect(vc!.proof.proofValue).toMatch(/^[0-9a-f]{128}$/i);

      // Verify the credential using standalone verifier
      const verification = await verifyDataCenterSustainabilityVC(vc!);
      expect(verification.valid).toBe(true);
    });
  });

  describe("Regulatory ESG & AI Compliance Packages", () => {
    it("generates an EU AI Act & ISO 14064 GHG audit-grade package", async () => {
      prismaMock.agentEvidence.findMany.mockResolvedValue([
        {
          id: "ev_1",
          sourceType: "datacenter_telemetry",
          normalizedEventType: "HARDWARE_POWER_VALIDATION",
          validationSignalPresent: true,
          observedAt: new Date("2026-08-21T04:00:00Z"),
          sourceDigest: JSON.stringify({
            origin: "live-instrument",
            delta_power_pct: -10.0,
            policy_setpoint_applied: "power_governor_v2",
            energy_saved_kwh: 50.0,
            carbon_avoided_kg: 18.2,
          }),
        },
      ]);

      const pkg = await buildDataCenterCompliancePackage(clusterCommitment, "EU_AI_ACT");

      expect(pkg).not.toBeNull();
      expect(pkg!.framework).toBe("EU_AI_ACT");
      expect(pkg!.controls.length).toBeGreaterThan(0);

      const energyControl = pkg!.controls.find((c) => c.control_id === "EU_AI_ART_51_ENERGY");
      expect(energyControl?.status).toBe("SATISFIED");
      expect(pkg!.signature).toMatch(/^[0-9a-f]{128}$/i);
    });
  });
});
