import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getProjects, POST as postProjects } from "../fund/projects/route";
import { POST as postMilestones } from "../fund/milestones/route";
import * as fund from "@/lib/reserves/industrialization-fund";
import type { StabilizationDisbursement, SovereignIndustrialProject } from "@prisma/client";

describe("Sovereign Industrialization Fund API Endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/reserves/fund/projects", () => {
    it("registers an industrialization project and returns 201", async () => {
      vi.spyOn(fund, "registerIndustrialProject").mockResolvedValue({
        id: "proj_1",
        projectCode: "PROJ-IRR-ML-001",
        projectName: "Solar Irrigation",
        category: "WATER_IRRIGATION",
        countryCode: "ML",
        districtName: "Sikasso",
        status: "FUNDED",
        allocatedAngel: 5000,
        totalMilestones: 3,
        completedMilestones: 0,
        expectedJobs: 10,
        jobsCreated: 0,
        declaredImpactKwh: 1000,
        realizedImpactKwh: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as SovereignIndustrialProject);

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/fund/projects", {
        method: "POST",
        body: JSON.stringify({
          project_code: "PROJ-IRR-ML-001",
          project_name: "Solar Irrigation",
          category: "WATER_IRRIGATION",
          country_code: "ML",
          district_name: "Sikasso",
          operator_commitment: "o".repeat(64),
          allocated_angel: 5000,
        }),
      });

      const res = await postProjects(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.project.project_code).toBe("PROJ-IRR-ML-001");
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/fund/projects", {
        method: "POST",
        body: JSON.stringify({ project_code: "PROJ-1" }),
      });

      const res = await postProjects(req);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/reserves/fund/projects", () => {
    it("returns 200 with fund projects and stabilization metrics", async () => {
      vi.spyOn(fund, "listFundProjects").mockResolvedValue({
        projects: [],
        balance: {
          totalBalance: 100000,
          coldHibernationReserve: 25000,
          deployableBalance: 75000,
        },
        solvency: {
          totalBalance: 100000,
          coldHibernationReserve: 25000,
          deployableBalance: 75000,
          totalAllocatedAngel: 5000,
          deployedInRolling365d: 2000,
          bufferSolvent: true,
        },
      });
      vi.spyOn(fund, "getIndustrializationMetrics").mockResolvedValue({
        activeProjectsCount: 1,
        totalProjects: 2,
        totalDeployedAngel: 10000,
        totalJobsCreated: 20,
        totalCompletedMilestones: 3,
        totalRealizedImpactKwh: 500,
        balance: {
          totalBalance: 100000,
          coldHibernationReserve: 25000,
          deployableBalance: 75000,
        },
        solvency: {
          totalBalance: 100000,
          coldHibernationReserve: 25000,
          deployableBalance: 75000,
          totalAllocatedAngel: 10000,
          deployedInRolling365d: 2000,
          bufferSolvent: true,
        },
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/fund/projects");
      const res = await getProjects(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.metrics.totalDeployedAngel).toBe(10000);
      expect(data.balance.coldHibernationReserve).toBe(25000);
    });
  });

  describe("POST /api/v1/reserves/fund/milestones", () => {
    it("verifies milestone completion and returns 200", async () => {
      vi.spyOn(fund, "verifyMilestoneCompletion").mockResolvedValue({
        disbursement: {
          disbursementId: "DISB-1",
          milestoneNumber: 1,
          status: "PAID",
          amountAngel: 1666,
          disbursedAt: new Date("2026-09-08T12:00:00Z"),
        } as unknown as StabilizationDisbursement,
        project: {
          projectCode: "PROJ-IRR-ML-001",
          status: "ACTIVE",
          completedMilestones: 1,
          totalMilestones: 3,
        } as unknown as SovereignIndustrialProject,
        isComplete: false,
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/fund/milestones", {
        method: "POST",
        body: JSON.stringify({
          disbursement_id: "DISB-1",
          verifier_signature: "sig",
          verifier_public_key: "pk",
          media_digest: "d".repeat(64),
        }),
      });

      const res = await postMilestones(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.disbursement.status).toBe("PAID");
      expect(data.is_complete).toBe(false);
    });

    it("rejects missing verifier fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/fund/milestones", {
        method: "POST",
        body: JSON.stringify({ disbursement_id: "DISB-1" }),
      });

      const res = await postMilestones(req);
      expect(res.status).toBe(400);
    });
  });
});