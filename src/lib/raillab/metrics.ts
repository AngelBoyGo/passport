/**
 * Rail Factory KPI board (Phase 19). Self-reports the factory's own efficiency so we can
 * verify — not just assert — that the machine is improving us.
 */

import { prisma } from "@/lib/db";

export interface FactoryOverview {
  railsBooted: number;
  railsEnabled: number;
  railsQuarantined: number;
  railsRetired: number;
  totalCandidates: number;
  automatedBlueprints: number;
  promotionRate: number;
  quarantineRate: number;
  meanTimeToEnableMs: number | null;
  successfulBlueprintPromotions: number;
}

export async function computeOverview(): Promise<FactoryOverview> {
  const [specs, candidates, runbooks] = await Promise.all([
    prisma.railSpec.findMany({
      select: { state: true, createdAt: true, updatedAt: true },
    }),
    prisma.railCandidate.count(),
    prisma.railRunbook.findMany({ select: { automated: true } }),
  ]);

  const enabled = specs.filter((s) => s.state === "ENABLED");
  const quarantined = specs.filter((s) => s.state === "QUARANTINED");
  const retired = specs.filter((s) => s.state === "RETIRED");
  const booted = enabled.length + quarantined.length;

  const promotionRate =
    specs.length > 0 ? enabled.length / specs.length : 0;
  const quarantineRate =
    booted > 0 ? quarantined.length / booted : 0;

  let meanTimeToEnableMs: number | null = null;
  if (enabled.length > 0) {
    const total = enabled.reduce(
      (sum, s) => sum + (s.updatedAt.getTime() - s.createdAt.getTime()),
      0
    );
    meanTimeToEnableMs = Math.round(total / enabled.length);
  }

  const automatedBlueprints = runbooks.filter((r) => r.automated).length;

  return {
    railsBooted: booted,
    railsEnabled: enabled.length,
    railsQuarantined: quarantined.length,
    railsRetired: retired.length,
    totalCandidates: candidates,
    automatedBlueprints,
    promotionRate: Number(promotionRate.toFixed(4)),
    quarantineRate: Number(quarantineRate.toFixed(4)),
    meanTimeToEnableMs,
    successfulBlueprintPromotions: automatedBlueprints,
  };
}
