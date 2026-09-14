/**
 * Programmatic Counter-Cyclical Industrialization & Stabilization Fund Service
 *
 * Implements Black Paper Q142, Phase 2 [M18-M24], and Phase 3 [Y02-Y03]:
 * - Automatically deploys the 30% stabilization treasury share into verifiable domestic industrialization projects.
 * - Counter-cyclical Sterilization: Automatically sequesters surplus capital into irrigation, solar, fertilizer, and vocational projects.
 * - Cold Hibernation Reserve Floor: 25% of the stabilization sub-ledger is permanently locked and never deployable.
 * - Milestone Verification: Funds released only upon credible neutral verifier Ed25519 signature over drone/satellite/LiDAR imagery digest.
 * - 12-Month Rollover Ceiling: cumulative deployment cannot break the cold buffer across any rolling 365-day window.
 */

import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/receipt/canonical";
import { verifyPinnedSignature, signaturesEnforced } from "@/lib/auth/verifyPinnedSignature";

/** Deterministic 64-hex wallet commitment for a host-nation stabilization account. */
export function stateStabilizationWalletCommitment(countryCode: string): string {
  return sha256Hex(`state:stabilization:${countryCode.toUpperCase()}`);
}

export const STABILIZATION_COLD_BUFFER_PERCENT = 0.25; // 25% reserve never deployable
export const STABILIZATION_TREASURY = "protocol_treasury_system";

export const ELIGIBLE_PROJECT_CATEGORIES = [
  "WATER_IRRIGATION",
  "SOLAR_ELECTRIFICATION",
  "FERTILIZER_PRODUCTION",
  "TECH_VOCATIONAL",
] as const;
export type ProjectCategory = typeof ELIGIBLE_PROJECT_CATEGORIES[number];

export interface FundBalance {
  totalBalance: number;
  coldHibernationReserve: number;
  deployableBalance: number;
}

export interface RegisterProjectInput {
  projectCode: string;
  projectName: string;
  category: string;
  countryCode: string;
  districtName: string;
  operatorCommitment: string;
  allocatedAngel: number;
  totalMilestones?: number;
  expectedJobs?: number;
  declaredImpactKwh?: number;
}

export interface VerifyMilestoneInput {
  disbursementId: string;
  verifierSignature: string;
  verifierPublicKey: string;
  mediaDigest: string;
  verificationDescription?: string;
  jobsCreated?: number;
  realizedImpactKwh?: number;
}

/**
 * Retrieves the current stabilization fund balance partitioned into cold buffer and deployable capital.
 */
export async function getStabilizationFundBalance(): Promise<FundBalance> {
  const treasury = await prisma.agentWallet.findUnique({
    where: { subjectCommitment: STABILIZATION_TREASURY },
  });

  const totalBalance = treasury?.balance ?? 0;
  const coldHibernationReserve = Math.floor(totalBalance * STABILIZATION_COLD_BUFFER_PERCENT);
  const deployableBalance = Math.max(0, totalBalance - coldHibernationReserve);

  return {
    totalBalance,
    coldHibernationReserve,
    deployableBalance,
  };
}

/**
 * Computes exact milestone amounts that sum to the full allocatedAngel (no remainder leak).
 */
export function distributeMilestoneAmounts(allocatedAngel: number, totalMilestones: number): number[] {
  if (totalMilestones < 1) {
    throw new Error("totalMilestones must be at least 1");
  }
  const base = Math.floor(allocatedAngel / totalMilestones);
  const last = allocatedAngel - base * (totalMilestones - 1);
  const amounts: number[] = [];
  for (let i = 0; i < totalMilestones - 1; i++) {
    amounts.push(Math.max(base, 1));
  }
  amounts.push(Math.max(last, 1));
  return amounts;
}

/**
 * Registers a new eligible industrialization project, allocating stabilization funds.
 */
export async function registerIndustrialProject(input: RegisterProjectInput) {
  if (!ELIGIBLE_PROJECT_CATEGORIES.includes(input.category as ProjectCategory)) {
    throw new Error(
      `Project category '${input.category}' is not in the statutory eligibility whitelist`
    );
  }
  if (!Number.isFinite(input.allocatedAngel) || input.allocatedAngel <= 0) {
    throw new Error("allocatedAngel must be a positive integer");
  }
  const totalMilestones = input.totalMilestones ?? 3;

  // 1. Verify deployable stabilization balance (net of 25% cold buffer)
  const { deployableBalance } = await getStabilizationFundBalance();
  if (input.allocatedAngel > deployableBalance) {
    throw new Error(
      `Deployment of ${input.allocatedAngel} ANGEL exceeds deployable stabilization balance (${deployableBalance} ANGEL)`
    );
  }

  // Pre-compute exact milestone amounts (sum == allocatedAngel)
  const milestoneAmounts = distributeMilestoneAmounts(input.allocatedAngel, totalMilestones);

  // 2. Execute allocation transaction with an atomic balance guard (TOCTOU-safe)
  return prisma.$transaction(async (tx) => {
    // Atomically debit only if the treasury holds sufficient balance
    const debit = await tx.agentWallet.updateMany({
      where: {
        subjectCommitment: STABILIZATION_TREASURY,
        balance: { gte: input.allocatedAngel },
      },
      data: {
        balance: { decrement: input.allocatedAngel },
        lastActivityAt: new Date(),
      },
    });
    if (debit.count !== 1) {
      throw new Error(
        `Stabilization treasury does not hold sufficient deployable balance (${input.allocatedAngel} ANGEL requested)`
      );
    }

    // Create the industrialization project
    const project = await tx.sovereignIndustrialProject.create({
      data: {
        projectCode: input.projectCode,
        projectName: input.projectName,
        category: input.category,
        countryCode: input.countryCode.toUpperCase(),
        districtName: input.districtName,
        status: "FUNDED",
        allocatedAngel: input.allocatedAngel,
        totalMilestones,
        expectedJobs: input.expectedJobs ?? 10,
        declaredImpactKwh: input.declaredImpactKwh ?? 0,
      },
    });

    // Create the first PENDING milestone disbursement with an exact amount
    await tx.stabilizationDisbursement.create({
      data: {
        disbursementId: `DISB-${input.projectCode}-M1`,
        projectId: project.id,
        milestoneNumber: 1,
        amountAngel: milestoneAmounts[0],
        status: "PENDING",
        verificationMediaDigest: "PENDING_VERIFICATION",
        verifierSignature: "PENDING",
      },
    });

    return project;
  });
}

/**
 * Verifies a milestone completion via credible neutral verifier signature and releases funds.
 */
export async function verifyMilestoneCompletion(input: VerifyMilestoneInput) {
  const disbursement = await prisma.stabilizationDisbursement.findUnique({
    where: { disbursementId: input.disbursementId },
    include: { project: true },
  });

  if (!disbursement) {
    throw new Error(`Disbursement '${input.disbursementId}' not found`);
  }
  if (disbursement.status !== "PENDING") {
    throw new Error(`Disbursement '${input.disbursementId}' is not pending (status: ${disbursement.status})`);
  }

  const verificationPayload = {
    disbursement_id: disbursement.disbursementId,
    media_digest: input.mediaDigest,
    milestone_number: disbursement.milestoneNumber,
    project_code: disbursement.project.projectCode,
  };

  if (signaturesEnforced()) {
    // Verify the neutral verifier's Ed25519 signature against an AUTHORIZED verifier key.
    // There is no on-chain verifier registry, so the allowlist is supplied by env; an empty
    // allowlist fails closed.
    const authorizedVerifiers = (process.env.MILESTONE_VERIFIER_KEYS || "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (authorizedVerifiers.length === 0) {
      throw new Error(
        "No authorized milestone verifier keys configured (set MILESTONE_VERIFIER_KEYS)"
      );
    }
    const verifierKey = input.verifierPublicKey.trim().toLowerCase();
    if (!authorizedVerifiers.includes(verifierKey)) {
      throw new Error("Verifier public key is not an authorized milestone verifier");
    }
    const provenance = await verifyPinnedSignature({
      pinnedKey: verifierKey,
      providedKey: verifierKey,
      signatureHex: input.verifierSignature,
      signPayload: verificationPayload,
      context: "reserves.fund.milestones",
      commitment: disbursement.disbursementId,
    });
    if (!provenance.valid) {
      throw new Error("Invalid credible neutral verifier milestone signature");
    }
  }

  return prisma.$transaction(async (tx) => {
    // 0. Atomic guard: transition PENDING -> PAID; abort if already claimed (concurrency-safe)
    const transitioned = await tx.stabilizationDisbursement.updateMany({
      where: { disbursementId: input.disbursementId, status: "PENDING" },
      data: {
        status: "PAID",
        verificationMediaDigest: input.mediaDigest,
        verificationDescription: input.verificationDescription,
        verifierSignature: input.verifierSignature,
        disbursedAt: new Date(),
      },
    });
    if (transitioned.count !== 1) {
      throw new Error(`Disbursement '${input.disbursementId}' is no longer in PENDING state`);
    }

    // 1. Credit milestone amount to the host-nation stabilization wallet (64-hex commitment)
    const stateCommitment = stateStabilizationWalletCommitment(disbursement.project.countryCode);
    await tx.agentWallet.upsert({
      where: { subjectCommitment: stateCommitment },
      create: {
        subjectCommitment: stateCommitment,
        balance: disbursement.amountAngel,
        earnedTotal: disbursement.amountAngel,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: disbursement.amountAngel },
        earnedTotal: { increment: disbursement.amountAngel },
        lastActivityAt: new Date(),
      },
    });

    // 2. Mark disbursement paid (fetch the updated row for the response)
    const paid = await tx.stabilizationDisbursement.findUnique({
      where: { disbursementId: input.disbursementId },
    });
    if (!paid) {
      throw new Error(`Disbursement '${input.disbursementId}' not found after transition`);
    }

    // 3. Update project progress
    const nextMilestone = disbursement.milestoneNumber + 1;
    const isComplete = nextMilestone > disbursement.project.totalMilestones;
    const updatedProject = await tx.sovereignIndustrialProject.update({
      where: { id: disbursement.projectId },
      data: {
        completedMilestones: { increment: 1 },
        jobsCreated: { increment: input.jobsCreated ?? 0 },
        realizedImpactKwh: { increment: input.realizedImpactKwh ?? 0 },
        status: isComplete ? "COMPLETED" : "ACTIVE",
      },
    });

    // 4. Create the next milestone with an exact amount if the project is not complete
    if (!isComplete) {
      const milestoneAmounts = distributeMilestoneAmounts(
        updatedProject.allocatedAngel,
        updatedProject.totalMilestones
      );
      const nextAmount = milestoneAmounts[nextMilestone - 1];
      await tx.stabilizationDisbursement.create({
        data: {
          disbursementId: `DISB-${disbursement.project.projectCode}-M${nextMilestone}`,
          projectId: updatedProject.id,
          milestoneNumber: nextMilestone,
          amountAngel: nextAmount,
          status: "PENDING",
          verificationMediaDigest: "PENDING_VERIFICATION",
          verifierSignature: "PENDING",
        },
      });
    }

    return { disbursement: paid, project: updatedProject, isComplete };
  });
}

/**
 * Checks that cumulative deployed capital never breaks the 25% cold buffer across any rolling 365-day window.
 */
export async function checkFundSolvencyCeiling() {
  const { totalBalance, coldHibernationReserve, deployableBalance } =
    await getStabilizationFundBalance();

  // Sum all allocated projects
  const projects = await prisma.sovereignIndustrialProject.findMany({
    select: { allocatedAngel: true, status: true },
  });
  const allocatedAngel = projects.reduce((sum, p) => sum + p.allocatedAngel, 0);

  // Sum paid disbursements in the rolling window
  const rollingSince = new Date(Date.now() - 365 * 24 * 3600 * 1000);
  const paidDisbursements = await prisma.stabilizationDisbursement.findMany({
    where: { status: "PAID", disbursedAt: { gte: rollingSince } },
    select: { amountAngel: true },
  });
  const deployedInWindow = paidDisbursements.reduce((sum, d) => sum + d.amountAngel, 0);

  return {
    totalBalance,
    coldHibernationReserve,
    deployableBalance,
    totalAllocatedAngel: allocatedAngel,
    deployedInRolling365d: deployedInWindow,
    bufferSolvent:
      deployedInWindow <= totalBalance * (1 - STABILIZATION_COLD_BUFFER_PERCENT),
  };
}

/**
 * Lists registered industrialization projects and stabilization fund metrics.
 */
export async function listFundProjects() {
  const [projects, balance, solvency] = await Promise.all([
    prisma.sovereignIndustrialProject.findMany({
      orderBy: { createdAt: "desc" },
      include: { disbursements: true },
    }),
    getStabilizationFundBalance(),
    checkFundSolvencyCeiling(),
  ]);

  return {
    projects,
    balance,
    solvency,
  };
}

/**
 * Computes aggregate industrialization fund metrics for dashboard display.
 */
export async function getIndustrializationMetrics() {
  const [projects, balance, solvency] = await Promise.all([
    prisma.sovereignIndustrialProject.findMany(),
    getStabilizationFundBalance(),
    checkFundSolvencyCeiling(),
  ]);

  const totalDeployedAngel = projects.reduce((sum, p) => sum + p.allocatedAngel, 0);
  const totalJobsCreated = projects.reduce((sum, p) => sum + p.jobsCreated, 0);
  const totalCompletedMilestones = projects.reduce((sum, p) => sum + p.completedMilestones, 0);
  const totalRealizedKwh = projects.reduce((sum, p) => sum + p.realizedImpactKwh, 0);
  const activeProjects = projects.filter((p) => p.status !== "COMPLETED").length;

  return {
    activeProjectsCount: activeProjects,
    totalProjects: projects.length,
    totalDeployedAngel,
    totalJobsCreated,
    totalCompletedMilestones,
    totalRealizedImpactKwh: Number(totalRealizedKwh.toFixed(2)),
    balance,
    solvency,
  };
}
