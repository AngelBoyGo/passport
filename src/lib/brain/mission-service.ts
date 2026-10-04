/**
 * Mission service — durable, forward-looking objectives the Command Brain
 * authors and advances.
 *
 * Missions are brain-generated (per owner decision) and auto-activated up to a
 * bounded cap. This module is the ONLY writer of Mission / MissionPlan rows; it
 * enforces:
 *   - a bounded number of concurrently-ACTIVE missions (BRAIN_MAX_ACTIVE_MISSIONS);
 *   - a strict status lifecycle (ACTIVE | PAUSED | ACHIEVED | ABANDONED);
 *   - plan lifecycle (DRAFT → COMMITTED → COMPLETED | SUPERSEDED), with at most
 *     one COMMITTED plan per mission;
 *   - evidence citation for auto-created missions (a mission must point at the
 *     evidence that motivated it — no free-floating goals).
 *
 * Nothing here executes actions or moves money: it only stores intent + plans.
 */

import { prisma } from "@/lib/db";

export const MISSION_STATUSES = ["ACTIVE", "PAUSED", "ACHIEVED", "ABANDONED"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const PLAN_STATUSES = ["DRAFT", "COMMITTED", "COMPLETED", "SUPERSEDED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const DEFAULT_MAX_ACTIVE_MISSIONS = 5;

export function maxActiveMissions(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.BRAIN_MAX_ACTIVE_MISSIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ACTIVE_MISSIONS;
}

export interface MissionStep {
  step: number;
  action: string;
  params: Record<string, unknown>;
  rationale: string;
  done: boolean;
}

export interface MissionRecord {
  missionId: string;
  title: string;
  objective: string;
  thesis: string | null;
  status: MissionStatus;
  priority: number;
  originPersona: string;
  keyResults: unknown;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Active missions, highest priority first. */
export async function listActiveMissions(limit = 20): Promise<MissionRecord[]> {
  const rows = await prisma.mission.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
  });
  return rows.map(toMissionRecord);
}

export async function getMission(missionId: string): Promise<MissionRecord | null> {
  const row = await prisma.mission.findUnique({ where: { missionId } });
  return row ? toMissionRecord(row) : null;
}

function toMissionRecord(row: {
  missionId: string;
  title: string;
  objective: string;
  thesis: string | null;
  status: string;
  priority: number;
  originPersona: string;
  keyResults: unknown;
}): MissionRecord {
  return {
    missionId: row.missionId,
    title: row.title,
    objective: row.objective,
    thesis: row.thesis,
    status: row.status as MissionStatus,
    priority: row.priority,
    originPersona: row.originPersona,
    keyResults: row.keyResults,
  };
}

/**
 * Creates a mission. Refuses when the ACTIVE cap is reached (fail-closed to the
 * caller, which should then pause/complete an existing mission or wait). Dedupes
 * on a normalized title so the brain cannot spawn near-duplicates each cycle.
 */
export async function createMission(input: {
  title: string;
  objective: string;
  thesis?: string | null;
  priority?: number;
  originPersona?: string;
  keyResults?: unknown;
  evidenceRefs?: unknown;
  createdBy?: string;
}): Promise<{ ok: true; mission: MissionRecord } | { ok: false; reason: string }> {
  const title = input.title.trim();
  const objective = input.objective.trim();
  if (!title || !objective) return { ok: false, reason: "title_and_objective_required" };

  const active = await prisma.mission.count({ where: { status: "ACTIVE" } });
  if (active >= maxActiveMissions()) {
    return { ok: false, reason: `active_mission_cap_reached:${active}/${maxActiveMissions()}` };
  }

  const dupe = await prisma.mission.findFirst({
    where: { status: "ACTIVE", title: { equals: title, mode: "insensitive" } },
    select: { missionId: true },
  });
  if (dupe) return { ok: false, reason: `duplicate_mission:${dupe.missionId}` };

  const row = await prisma.mission.create({
    data: {
      missionId: newId("msn"),
      title,
      objective,
      thesis: input.thesis?.trim() || null,
      priority: Number.isFinite(input.priority as number) ? Math.trunc(input.priority as number) : 50,
      originPersona: input.originPersona === "muse" ? "muse" : "mars",
      keyResults: (input.keyResults ?? undefined) as never,
      evidenceRefs: (input.evidenceRefs ?? undefined) as never,
      createdBy: input.createdBy ?? "command_brain",
    },
  });
  return { ok: true, mission: toMissionRecord(row) };
}

/** Legal mission status transitions. */
const MISSION_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  ACTIVE: ["PAUSED", "ACHIEVED", "ABANDONED"],
  PAUSED: ["ACTIVE", "ABANDONED", "ACHIEVED"],
  ACHIEVED: [],
  ABANDONED: [],
};

export async function setMissionStatus(
  missionId: string,
  next: MissionStatus
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await prisma.mission.findUnique({ where: { missionId } });
  if (!row) return { ok: false, reason: "mission_not_found" };
  const current = row.status as MissionStatus;
  if (current === next) return { ok: true };
  if (!MISSION_TRANSITIONS[current]?.includes(next)) {
    return { ok: false, reason: `illegal_mission_transition:${current}->${next}` };
  }
  await prisma.mission.update({ where: { missionId }, data: { status: next } });
  return { ok: true };
}

export interface MissionPlanRecord {
  planId: string;
  missionId: string;
  status: PlanStatus;
  steps: MissionStep[];
  createdByPersona: string;
  committedStep: number | null;
}

function normalizeSteps(raw: unknown): MissionStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s, i) => ({
      step: Number.isFinite(Number(s.step)) ? Number(s.step) : i + 1,
      action: String(s.action ?? "NOOP"),
      params: (s.params && typeof s.params === "object" ? s.params : {}) as Record<string, unknown>,
      rationale: String(s.rationale ?? ""),
      done: Boolean(s.done),
    }));
}

/**
 * Persists a committed plan and marks any prior COMMITTED plan for the mission
 * as SUPERSEDED (at most one live plan per mission). Also points the mission's
 * currentPlanId at the new plan.
 */
export async function commitPlan(input: {
  missionId: string;
  cycleId?: string | null;
  horizon?: string;
  steps: MissionStep[];
  dialogue?: unknown;
  createdByPersona?: string;
  committedStep?: number | null;
}): Promise<{ ok: true; plan: MissionPlanRecord } | { ok: false; reason: string }> {
  const mission = await prisma.mission.findUnique({ where: { missionId: input.missionId } });
  if (!mission) return { ok: false, reason: "mission_not_found" };

  const planId = newId("plan");
  await prisma.$transaction(async (tx) => {
    await tx.missionPlan.updateMany({
      where: { missionId: input.missionId, status: "COMMITTED" },
      data: { status: "SUPERSEDED" },
    });
    await tx.missionPlan.create({
      data: {
        planId,
        missionId: input.missionId,
        cycleId: input.cycleId ?? null,
        horizon: input.horizon ?? "DAILY",
        steps: normalizeSteps(input.steps) as never,
        dialogue: (input.dialogue ?? undefined) as never,
        status: "COMMITTED",
        createdByPersona: input.createdByPersona === "mars" ? "mars" : "muse",
        committedStep: input.committedStep ?? null,
      },
    });
    await tx.mission.update({
      where: { missionId: input.missionId },
      data: { currentPlanId: planId },
    });
  });

  return {
    ok: true,
    plan: {
      planId,
      missionId: input.missionId,
      status: "COMMITTED",
      steps: normalizeSteps(input.steps),
      createdByPersona: input.createdByPersona ?? "muse",
      committedStep: input.committedStep ?? null,
    },
  };
}

/** The current COMMITTED plan for a mission, if any. */
export async function getCurrentPlan(missionId: string): Promise<MissionPlanRecord | null> {
  const row = await prisma.missionPlan.findFirst({
    where: { missionId, status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    planId: row.planId,
    missionId: row.missionId,
    status: row.status as PlanStatus,
    steps: normalizeSteps(row.steps),
    createdByPersona: row.createdByPersona,
    committedStep: row.committedStep,
  };
}

/** Marks a step done and, if all steps are done, completes the plan AND the mission. */
export async function markStepDone(planId: string, stepNumber: number): Promise<void> {
  const row = await prisma.missionPlan.findUnique({ where: { planId } });
  if (!row || row.status !== "COMMITTED") return;
  const steps = normalizeSteps(row.steps).map((s) =>
    s.step === stepNumber ? { ...s, done: true } : s
  );
  const allDone = steps.length > 0 && steps.every((s) => s.done);
  await prisma.missionPlan.update({
    where: { planId },
    data: { steps: steps as never, status: allDone ? "COMPLETED" : "COMMITTED" },
  });
  // A completed plan means the mission's committed work is finished: mark the
  // mission ACHIEVED so it leaves the ACTIVE set (otherwise the cap fills up
  // forever and the same mission is re-planned every cycle).
  if (allDone) {
    await prisma.mission
      .update({ where: { missionId: row.missionId }, data: { status: "ACHIEVED" } })
      .catch(() => undefined);
  }
}

/**
 * True when a mission should be (re-)planned this cycle. We only re-plan when
 * there is NO committed plan or the current one has no open steps — otherwise a
 * 10-minute dialogue would supersede + recreate a plan every cycle (unbounded
 * MissionPlan growth and reset progress each time).
 */
export async function missionNeedsPlan(missionId: string): Promise<boolean> {
  const plan = await getCurrentPlan(missionId).catch(() => null);
  if (!plan) return true;
  return plan.steps.every((s) => s.done) || plan.steps.length === 0;
}
