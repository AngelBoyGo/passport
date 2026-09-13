/**
 * Central AI Command Brain (Phase 37).
 *
 * A single supervisor that observes the whole system each cycle, decides ONE bounded action, and
 * records what it did — with PERSISTENT MEMORY and a simple learning loop. It is deliberately
 * constrained: the action space is an allowlist of reversible/advisory operations, and it can
 * NEVER move money. The LLM runs through the api.metis.gold KeyForge gateway (LLM_* env).
 *
 * Memory: every cycle writes an OBSERVATION (the datapoints it saw), a DECISION (action +
 * rationale), and an OUTCOME (result). The next cycle is fed recent memory plus a "playbook"
 * (per-action success rates) — so the brain retains context and learns which actions help.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { brainComplete, parseJsonObject } from "@/lib/raillab/factory-brain";
import { buildEconomyHealth } from "@/lib/agent-economy/economy-health";
import { runIntegrityCheck } from "@/lib/raillab/integrity";
import { runDiscovery } from "@/lib/raillab/discovery";
import { runExecutionTick } from "@/lib/raillab/executor";
import { runIntegrityAttestation } from "@/lib/raillab/attest";
import { quarantineRailSpec } from "@/lib/raillab/factory-agent";

/** The ONLY actions the brain may take. No money-moving operation is ever in this list. */
export const BRAIN_ACTIONS = [
  "NOOP",
  "RECORD_NOTE",
  "RUN_DISCOVERY",
  "RUN_TICK",
  "TRIGGER_ATTESTATION",
  "QUARANTINE_RAIL",
  "INVESTIGATE_DISPUTE",
] as const;
export type BrainAction = (typeof BRAIN_ACTIONS)[number];

export const BRAIN_MEMORY_READ_LIMIT = 12;

export interface BrainDatapoints {
  economy: Record<string, unknown>;
  integrity: { ok: boolean; issues: string[] };
  rails: { enabled: number; quarantined: number };
  disputes_open: number;
  health_score: number;
}

/** Composite 0..1 health used for trend/learning. Penalties for under-collateralization,
 *  integrity issues, and open disputes. */
export function computeHealthScore(
  health: { reserve_adequate: boolean },
  integrity: { ok: boolean },
  disputesOpen: number
): number {
  let s = 1;
  if (!health.reserve_adequate) s -= 0.4;
  if (!integrity.ok) s -= 0.4;
  s -= Math.min(0.2, Math.max(0, disputesOpen) * 0.02);
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000;
}

export async function gatherDatapoints(now: Date): Promise<BrainDatapoints> {
  const [economyRes, integrity, enabled, quarantined, disputesOpen] = await Promise.all([
    buildEconomyHealth(now).catch(() => null),
    runIntegrityCheck().catch(() => ({ ok: false, issues: ["integrity read failed"] })),
    prisma.railSpec.count({ where: { state: "ENABLED" } }).catch(() => 0),
    prisma.railSpec.count({ where: { state: "QUARANTINED" } }).catch(() => 0),
    prisma.computeDispute.count({ where: { status: "OPEN" } }).catch(() => 0),
  ]);

  const economy = (economyRes?.health ?? {}) as { reserve_adequate?: boolean };
  const integ = integrity as { ok: boolean; issues: string[] };
  return {
    economy: economyRes?.health ? { ...economyRes.health } : {},
    integrity: { ok: Boolean(integ.ok), issues: integ.issues ?? [] },
    rails: { enabled, quarantined },
    disputes_open: disputesOpen,
    health_score: computeHealthScore(
      { reserve_adequate: Boolean((economy as any).reserve_adequate) },
      { ok: Boolean(integ.ok) },
      disputesOpen
    ),
  };
}

/** Per-action success rate over recorded OUTCOME memory. */
export function summarizePlaybook(
  outcomes: { action: string | null; actionResult: string | null }[]
): Record<string, { attempts: number; successes: number; successRate: number }> {
  const map: Record<string, { attempts: number; successes: number; successRate: number }> = {};
  for (const o of outcomes) {
    if (!o.action) continue;
    const entry = (map[o.action] ??= { attempts: 0, successes: 0, successRate: 0 });
    entry.attempts++;
    if (o.actionResult === "ok") entry.successes++;
  }
  for (const k of Object.keys(map)) {
    map[k].successRate = map[k].attempts > 0 ? Math.round((map[k].successes / map[k].attempts) * 100) / 100 : 0;
  }
  return map;
}

async function defaultAct(action: BrainAction, params: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "NOOP":
      return "ok";
    case "RECORD_NOTE":
      return "ok";
    case "RUN_DISCOVERY": {
      await runDiscovery();
      return "ok";
    }
    case "RUN_TICK": {
      await runExecutionTick();
      return "ok";
    }
    case "TRIGGER_ATTESTATION": {
      await runIntegrityAttestation();
      return "ok";
    }
    case "QUARANTINE_RAIL": {
      const railKey = String(params.rail_key ?? "").trim();
      if (!railKey) return "error: rail_key required";
      const spec = await prisma.railSpec.findUnique({ where: { railKey } });
      if (!spec) return "error: rail not found";
      await quarantineRailSpec(spec.id, String(params.reason ?? "command brain quarantine"));
      return "ok";
    }
    case "INVESTIGATE_DISPUTE":
      // Advisory only: flags a dispute for human/agent attention; no on-effect here.
      return "ok";
    default:
      return "error: unknown action";
  }
}

export interface BrainDeps {
  complete?: typeof brainComplete;
  gather?: (now: Date) => Promise<BrainDatapoints>;
  act?: (action: BrainAction, params: Record<string, unknown>) => Promise<string>;
}

export interface BrainReport {
  cycle_id: string;
  action: BrainAction;
  params: Record<string, unknown>;
  rationale: string;
  confidence: number;
  executed: boolean;
  action_result: string;
  health_score: number;
  error?: string;
}

const SYSTEM_PROMPT =
  "You are the Passport ASMC-3 Command Brain — the central supervisor of a commodity-backed " +
  "autonomous-agent economy. You are given the current system datapoints, your recent memory, " +
  "and a playbook of per-action success rates. Decide EXACTLY ONE action for this cycle. " +
  "You may ONLY choose from this allowlist: " +
  BRAIN_ACTIONS.join(", ") +
  ". You can NEVER move money or change balances. Prefer NOOP unless a datapoint clearly " +
  "warrants action (e.g. integrity issues -> TRIGGER_ATTESTATION; a broken rail -> QUARANTINE_RAIL; " +
  "stale discovery -> RUN_DISCOVERY). Use the playbook to favor actions with higher success rates. " +
  'Return STRICT JSON: {"action": "<one of the allowlist>", "params": {..}, "rationale": ' +
  '"<2-3 sentences>", "confidence": <float 0..1>}. No prose outside the JSON object.';

/**
 * Runs one brain cycle. Never throws on LLM failure — records the observation and returns a
 * NOOP decision with the reason (fail-closed).
 */
export async function runBrainCycle(now: Date = new Date(), deps: BrainDeps = {}): Promise<BrainReport> {
  const cycleId = `brn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const gather = deps.gather ?? gatherDatapoints;
  const act = deps.act ?? defaultAct;
  const complete = deps.complete ?? brainComplete;

  const datapoints = await gather(now);

  // Persistent memory: recent observations/decisions/outcomes + the learned playbook.
  const memory = await prisma.brainMemory
    .findMany({ orderBy: { createdAt: "desc" }, take: BRAIN_MEMORY_READ_LIMIT })
    .catch(() => [] as { kind: string; summary: string; action: string | null; actionResult: string | null }[]);
  const playbook = summarizePlaybook(
    memory.filter((m) => m.kind === "OUTCOME") as { action: string | null; actionResult: string | null }[]
  );

  await prisma.brainMemory
    .create({
      data: {
        cycleId,
        kind: "OBSERVATION",
        summary: `health=${datapoints.health_score} integrity=${datapoints.integrity.ok} disputes=${datapoints.disputes_open}`,
        data: datapoints as unknown as any,
        healthScore: datapoints.health_score,
      },
    })
    .catch(() => null);

  let action: BrainAction = "NOOP";
  let params: Record<string, unknown> = {};
  let rationale = "";
  let confidence = 0;
  let error: string | undefined;

  try {
    const raw = await complete({
      system: SYSTEM_PROMPT,
      user: JSON.stringify({
        datapoints,
        recent_memory: memory.map((m) => ({ kind: m.kind, summary: m.summary, action: m.action, result: m.actionResult })),
        playbook,
      }),
      json: true,
      temperature: 0.2,
    });
    const parsed = parseJsonObject(raw);
    const proposed = String(parsed.action ?? "").toUpperCase();
    if ((BRAIN_ACTIONS as readonly string[]).includes(proposed)) {
      action = proposed as BrainAction;
    } else {
      rationale = `Model proposed '${proposed}', which is not in the allowlist — defaulting to NOOP.`;
    }
    params = (parsed.params && typeof parsed.params === "object" ? (parsed.params as Record<string, unknown>) : {});
    if (!rationale) rationale = String(parsed.rationale ?? "");
    const c = Number(parsed.confidence);
    confidence = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    rationale = `Brain LLM unavailable (${error}); failing closed to NOOP.`;
  }

  await prisma.brainMemory
    .create({
      data: { cycleId, kind: "DECISION", summary: rationale.slice(0, 500), action, data: params as any },
    })
    .catch(() => null);

  let actionResult = "skipped";
  let executed = false;
  if (!error) {
    try {
      actionResult = await act(action, params);
      executed = actionResult === "ok";
    } catch (err) {
      actionResult = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    await prisma.brainMemory
      .create({
        data: { cycleId, kind: "OUTCOME", summary: `${action} -> ${actionResult}`.slice(0, 500), action, actionResult },
      })
      .catch(() => null);
  }

  return {
    cycle_id: cycleId,
    action,
    params,
    rationale,
    confidence,
    executed,
    action_result: actionResult,
    health_score: datapoints.health_score,
    ...(error ? { error } : {}),
  };
}