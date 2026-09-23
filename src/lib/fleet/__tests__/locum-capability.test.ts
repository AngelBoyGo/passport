import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, searchMock, playMock, haltMock } = vi.hoisted(() => ({
  prismaMock: {
    brainMemory: { create: vi.fn().mockResolvedValue({}) },
  },
  searchMock: vi.fn(),
  playMock: vi.fn(),
  haltMock: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/fleet/callora-fleet-client", () => ({
  searchLocumJobs: searchMock,
  playLocumJobs: playMock,
  calloraClientConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/fleet/fleet-service", () => ({ fleetHalted: haltMock }));

const { runLocumJobSearchCycle, locumCapabilityEnabled } = await import("@/lib/fleet/locum-capability");

function envSetup(cap = true) {
  if (cap) {
    process.env.FLEET_CAPABILITY_LOCUM_SEARCH_ENABLED = "true";
  } else {
    delete process.env.FLEET_CAPABILITY_LOCUM_SEARCH_ENABLED;
  }
}

beforeEach(() => {
  searchMock.mockReset();
  playMock.mockReset();
  haltMock.mockReturnValue(false);
  prismaMock.brainMemory.create.mockClear();
  envSetup(true);
});

const served = (rows: Array<Record<string, unknown>>) => ({
  ranked: rows,
  agreement: { agree: true, rank1_match: true, transpositions: 0 },
  order_version: "pay-v1",
  drift: false,
});

describe("locum capability — guards", () => {
  it("fleet halt blocks everything", async () => {
    haltMock.mockReturnValue(true);
    expect((await runLocumJobSearchCycle({ candidateId: "c1" })).reason).toBe("fleet_halted");
  });

  it("capability disabled by default (fail-closed opt-in)", async () => {
    envSetup(false);
    expect((await runLocumJobSearchCycle({ candidateId: "c1" })).reason).toBe("capability_disabled");
  });

  it("missing candidate id AND name is refused before any call", async () => {
    expect((await runLocumJobSearchCycle({ candidateId: "" })).reason).toBe("candidate_required");
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe("locum capability — the A1 loop", () => {
  it("searches, plays ONLY the top job, reports honestly", async () => {
    searchMock.mockResolvedValue(
      served([
        { job_id: "top", rate_usd_hourly: 465, title: "Rural ER", match_score: 50 },
        { job_id: "second", rate_usd_hourly: 390, title: "EM Locums", match_score: 40 },
      ])
    );
    playMock.mockResolvedValue({ queued: 1, note: "planning only" });

    const r = await runLocumJobSearchCycle({ candidateId: "cand" });

    expect(r.ok).toBe(true);
    expect(r.top_job).toMatchObject({ job_id: "top", rate_usd_hourly: 465 });
    expect(r.played).toBe(true);
    expect(r.queued).toBe(1);
    expect(r.drift).toBe(false);
    expect(playMock).toHaveBeenCalledWith({ candidateId: "cand", jobIds: ["top"] });
  });

  it("records a brain NOTE when drift is detected, and plays the BRAIN's top job", async () => {
    // The client returns `ranked` in the BRAIN's order (invariant: on drift the
    // brain trusts its own judgment). So ranked[0] is the brain's pick.
    searchMock.mockResolvedValue({
      ranked: [
        { job_id: "brain_top", rate_usd_hourly: 465, match_score: 0 },
        { job_id: "server_top", rate_usd_hourly: 360, match_score: 0 },
      ],
      served_ranked: [
        { job_id: "server_top", rate_usd_hourly: 360, match_score: 0 },
        { job_id: "brain_top", rate_usd_hourly: 465, match_score: 0 },
      ],
      served_order: ["server_top", "brain_top"],
      brain_order: ["brain_top", "server_top"],
      agreement: { agree: false, rank1_match: false, transpositions: 1 },
      order_version: "pay-v1",
      drift: true,
    });
    playMock.mockResolvedValue({ queued: 1, note: "planning" });

    const r = await runLocumJobSearchCycle({ candidateId: "cand" });

    expect(r.drift).toBe(true);
    expect(r.ranked_count).toBe(2);
    expect(playMock).toHaveBeenCalledWith({ candidateId: "cand", jobIds: ["brain_top"] });
    expect(prismaMock.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "NOTE" }) })
    );
    expect(r.played).toBe(true);
  });

  it("play failure surfaces honestly without pretending the search failed", async () => {
    searchMock.mockResolvedValue(
      served([{ job_id: "top", rate_usd_hourly: 465, title: "ER", match_score: 1 }])
    );
    playMock.mockRejectedValue(new Error("callora_503:down"));
    const r = await runLocumJobSearchCycle({ candidateId: "cand" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("play_failed");
  });

  it("no open jobs above floor = clean no-op (not an error)", async () => {
    searchMock.mockResolvedValue({ ranked: [], agreement: { agree: true, rank1_match: true, transpositions: 0 }, order_version: "pay-v1", drift: false });
    const r = await runLocumJobSearchCycle({ candidateId: "cand" });
    expect(r.ok).toBe(true);
    expect(r.ranked_count).toBe(0);
    expect(r.top_job).toBeNull();
    expect(playMock).not.toHaveBeenCalled();
  });
});

describe("locumCapabilityEnabled", () => {
  it("is off unless explicitly switched on", () => {
    envSetup(false);
    expect(locumCapabilityEnabled()).toBe(false);
    envSetup(true);
    expect(locumCapabilityEnabled()).toBe(true);
  });
});
