import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { requireIssuer } from "@/lib/auth/authorize";
import {
  registerIndustrialProject,
  listFundProjects,
  getIndustrializationMetrics,
} from "@/lib/reserves/industrialization-fund";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/fund/projects — List Sovereign Industrialization Projects & stabilization metrics.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:fund:projects:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const [data, metrics] = await Promise.all([
      listFundProjects(),
      getIndustrializationMetrics(),
    ]);

    return NextResponse.json(
      {
        success: true,
        metrics,
        balance: data.balance,
        solvency: data.solvency,
        projects: data.projects.map((p) => ({
          project_code: p.projectCode,
          project_name: p.projectName,
          category: p.category,
          country_code: p.countryCode,
          district_name: p.districtName,
          status: p.status,
          allocated_angel: p.allocatedAngel,
          total_milestones: p.totalMilestones,
          completed_milestones: p.completedMilestones,
          jobs_created: p.jobsCreated,
          realized_impact_kwh: p.realizedImpactKwh,
        })),
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/v1/reserves/fund/projects — Register a new Sovereign Industrialization Project.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:fund:projects:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  // Registering an industrialization project allocates sovereign stabilization ANGEL.
  const auth = await requireIssuer(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const projectCode = String(body.project_code || body.projectCode || "");
  const projectName = String(body.project_name || body.projectName || "");
  const category = String(body.category || "");
  const countryCode = String(body.country_code || body.countryCode || "");
  const districtName = String(body.district_name || body.districtName || "");
  const operatorCommitment = String(body.operator_commitment || body.operatorCommitment || "");
  const allocatedAngel = Number(body.allocated_angel ?? body.allocatedAngel);
  const totalMilestones = body.total_milestones ? Number(body.total_milestones) : undefined;
  const expectedJobs = body.expected_jobs ? Number(body.expected_jobs) : undefined;
  const declaredImpactKwh = body.declared_impact_kwh !== undefined ? Number(body.declared_impact_kwh) : undefined;

  if (
    !projectCode ||
    !projectName ||
    !category ||
    !countryCode ||
    !districtName ||
    !operatorCommitment ||
    isNaN(allocatedAngel)
  ) {
    return NextResponse.json(
      { error: "project_code, project_name, category, country_code, district_name, operator_commitment, allocated_angel are required" },
      { status: 400 }
    );
  }

  try {
    const project = await registerIndustrialProject({
      projectCode,
      projectName,
      category,
      countryCode,
      districtName,
      operatorCommitment,
      allocatedAngel,
      totalMilestones,
      expectedJobs,
      declaredImpactKwh,
    });

    return NextResponse.json(
      {
        success: true,
        project: {
          project_code: project.projectCode,
          project_name: project.projectName,
          category: project.category,
          country_code: project.countryCode,
          status: project.status,
          allocated_angel: project.allocatedAngel,
          total_milestones: project.totalMilestones,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}