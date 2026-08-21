import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn(), upsert: vi.fn() },
    agentEvidence: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    receipt: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    evidenceReceiptLink: { create: vi.fn() },
    operator: { findFirst: vi.fn() },
    agent: { findFirst: vi.fn(), create: vi.fn() },
    apiKey: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("DataCenter API Routes", () => {
  const clusterId = "vast-michigan-1";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("POST /api/v1/datacenter/evidence — ingests telemetry and returns signed receipt", async () => {
    prismaMock.operator.findFirst.mockResolvedValue({ id: "op_default" });
    prismaMock.agent.findFirst.mockResolvedValue({ id: "agent_rec_01" });
    prismaMock.agentEvidence.create.mockResolvedValue({
      id: "ev_01",
      eventCommitmentHash: "hash123",
    });
    prismaMock.receipt.create.mockResolvedValue({
      id: "rcpt_01",
      receiptId: "rcpt_dc_123",
      signature: "sig123",
    });
    prismaMock.evidenceReceiptLink.create.mockResolvedValue({ id: "link_01" });

    const { POST } = await import("@/app/api/v1/datacenter/evidence/route");
    const payload = {
      cluster_id: clusterId,
      instance_id: "vast-michigan-1",
      event_type: "HARDWARE_POWER_VALIDATION",
      timestamp_utc: "2026-08-21T05:00:00Z",
      origin: "live-instrument",
      sku: "NVIDIA_RTX_4090",
      telemetry_source: "nvml_v12.2",
      baseline_nameplate_w: 450,
      measured_power_avg_w: 406.8,
      delta_power_pct: -9.6,
      ramp_delta_pct: -14.7,
      latency_overhead_pct: 2.6,
      replicate_count: 5,
      policy_setpoint_applied: "gap7_load_stable",
      peak_junction_temp_c: 68.2,
    };

    const req = new NextRequest("https://passport.metis.gold/api/v1/datacenter/evidence", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.verified).toBe(true);
    expect(data.receipt_id).toBeDefined();
    expect(data.origin).toBe("live-instrument");
  });

  it("GET /api/v1/datacenter/clusters/:id/scorecard — returns cluster scorecard", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([
      {
        id: "ev_1",
        sourceType: "datacet_control_plane",
        normalizedEventType: "HARDWARE_POWER_VALIDATION",
        validationSignalPresent: true,
        observedAt: new Date("2026-08-21T04:00:00Z"),
        sourceDigest: JSON.stringify({
          origin: "live-instrument",
          delta_power_pct: -9.6,
          policy_setpoint_applied: "gap7_load_stable",
          energy_saved_kwh: 50.0,
          carbon_avoided_kg: 18.2,
        }),
      },
    ]);

    const { GET } = await import(
      "@/app/api/v1/datacenter/clusters/[id]/scorecard/route"
    );
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/datacenter/clusters/${clusterId}/scorecard`
    );
    const res = await GET(req, { params: Promise.resolve({ id: clusterId }) });

    expect(res.status).toBe(200);
    const scorecard = await res.json();
    expect(scorecard.acting_champion_policy).toBe("gap7_load_stable");
    expect(scorecard.avg_power_reduction_pct).toBe(-9.6);
  });

  it("GET /api/v1/datacenter/clusters/:id/credential — returns signed W3C sustainability credential", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([
      {
        id: "ev_1",
        sourceType: "datacet_control_plane",
        normalizedEventType: "HARDWARE_POWER_VALIDATION",
        validationSignalPresent: true,
        observedAt: new Date("2026-08-21T04:00:00Z"),
        sourceDigest: JSON.stringify({
          origin: "live-instrument",
          delta_power_pct: -9.6,
          policy_setpoint_applied: "gap7_load_stable",
        }),
      },
    ]);

    const { GET } = await import(
      "@/app/api/v1/datacenter/clusters/[id]/credential/route"
    );
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/datacenter/clusters/${clusterId}/credential`
    );
    const res = await GET(req, { params: Promise.resolve({ id: clusterId }) });

    expect(res.status).toBe(200);
    const vc = await res.json();
    expect(vc["@context"]).toContain("https://www.w3.org/ns/credentials/v2");
    expect(vc.type).toContain("DataCenterSustainabilityCredential");
    expect(vc.proof).toBeDefined();
  });
});
