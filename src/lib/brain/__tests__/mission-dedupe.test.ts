/* eslint-disable @typescript-eslint/no-explicit-any -- test harness uses partial Prisma mocks */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mission: {
      count: (...a: any[]) => h.count(...a),
      findFirst: (...a: any[]) => h.findFirst(...a),
      findMany: (...a: any[]) => h.findMany(...a),
      create: (...a: any[]) => h.create(...a),
    },
  },
}));

import { createMission, titleSimilarity } from "@/lib/brain/mission-service";

beforeEach(() => {
  vi.clearAllMocks();
  h.count.mockResolvedValue(0);
  h.findFirst.mockResolvedValue(null); // no ACTIVE exact-title duplicate
  h.create.mockResolvedValue({
    missionId: "msn_new",
    title: "t",
    objective: "o",
    thesis: null,
    status: "ACTIVE",
    priority: 50,
    originPersona: "mars",
    keyResults: null,
  });
});

describe("titleSimilarity", () => {
  it("flags the churned near-duplicate titles", () => {
    expect(
      titleSimilarity(
        "Moltbook-to-Passport Adoption Engine",
        "Moltbook-to-Passport Adoption Engine with ANGEL Evidence-Backstop"
      )
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      titleSimilarity(
        "Moltbook-to-Passport Adoption & ANGEL Circulation Engine",
        "Passport Adoption Flywheel: Fleet to Forum to ANGEL Circulation"
      )
    ).toBeGreaterThanOrEqual(0.4);
  });

  it("distinguishes a genuinely different mission", () => {
    expect(titleSimilarity("Close the first paid locum placement", "Moltbook adoption engine")).toBeLessThan(0.3);
  });
});

describe("createMission similarity dedupe", () => {
  it("rejects a brain mission similar to a recent one", async () => {
    h.findMany.mockResolvedValue([{ missionId: "msn_old", title: "Moltbook-to-Passport Adoption Engine" }]);
    const r = await createMission({
      title: "Moltbook-to-Passport Adoption Flywheel",
      objective: "x",
      createdBy: "command_brain",
    });
    expect(r.ok).toBe(false);
    expect((r as { reason?: string }).reason).toMatch(/similar_mission_exists/);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("allows an operator task even if similar (explicit intent)", async () => {
    h.findMany.mockResolvedValue([{ missionId: "msn_old", title: "Moltbook-to-Passport Adoption Engine" }]);
    const r = await createMission({
      title: "Moltbook-to-Passport Adoption Engine",
      objective: "x",
      createdBy: "operator",
    });
    expect(r.ok).toBe(true);
  });

  it("allows a genuinely new brain mission", async () => {
    h.findMany.mockResolvedValue([{ missionId: "msn_old", title: "Moltbook adoption engine" }]);
    const r = await createMission({
      title: "Close the first paid locum placement",
      objective: "x",
      createdBy: "command_brain",
    });
    expect(r.ok).toBe(true);
  });
});
