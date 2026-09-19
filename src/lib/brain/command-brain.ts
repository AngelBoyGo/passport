/**
 * Central AI Command Brain (Phase 37) — hardened in Phase 40.
 *
 * A single supervisor that observes the whole system each cycle, decides ONE bounded action, and
 * records what it did — with PERSISTENT MEMORY and a simple learning loop. It is deliberately
 * constrained: the action space is an allowlist of reversible/advisory operations, and it can
 * NEVER move money. The LLM runs through the api.metis.gold KeyForge gateway (LLM_* env).
 *
 * Memory: every cycle writes an OBSERVATION (the datapoints it saw), a DECISION (action +
 * rationale), and an OUTCOME (result). The next cycle is fed recent memory plus a "playbook"
 * (per-action success rates) — so the brain retains context and learns which actions help.
 *
 * Phase 40 hardening:
 *   - Distributed lease (BrainLease): only one cycle runs at a time across replicas;
 *     lease acquisition fails CLOSED (an uncoordinated cycle is worse than none).
 *   - Every cycle records an OUTCOME, including LLM_UNAVAILABLE / INVALID_PARAMS —
 *     gateway outages and malformed model output are now visible to the playbook.
 *   - Strict per-action Zod parameter validation (unknown keys rejected) before
 *     any action executes.
 *   - RUN_RESEARCH_SCAN: bounded internal self-research (telemetry → LLM audit →
 *     evidence). Read-only; performs no state changes.
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
import { acquireBrainLease, type BrainLeaseHandle } from "@/lib/brain/brain-lease";
import { validateActionParams } from "@/lib/brain/param-schemas";
import { runResearchScan } from "@/lib/brain/research-scan";
import { runExternalResearchScan } from "@/lib/brain/external-research";
import { isOutcomeSuccessful } from "@/lib/brain/outcomes";
import { evaluateRecentOutcomes } from "@/lib/brain/attribution";
import { createProposalsFromScan, getCanaryPolicy } from "@/lib/brain/proposal-service";
import { decideFromPolicy } from "@/lib/brain/policy";

/** The ONLY actions the brain may take. No money-moving operation is ever in this list. */
export const BRAIN_ACTIONS = [
  "NOOP",
  "RECORD_NOTE",
  "RUN_DISCOVERY",
  "RUN_TICK",
  "TRIGGER_ATTESTATION",
  "QUARANTINE_RAIL",
  "INVESTIGATE_DISPUTE",
  "RUN_RESEARCH_SCAN",
  "RUN_EXTERNAL_RESEARCH",
] as const;
export type BrainAction = (typeof BRAIN_ACTIONS)[number];

/** Explicit outcome classes recorded for every cycle (Phase 40). */
export type BrainOutcomeClass =
  | "ACTION_SUCCEEDED"
  | "ACTION_FAILED"
  | "ACTION_SKIPPED"
  | "INVALID_PARAMS"
  | "LLM_UNAVAILABLE";

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
    if (isOutcomeSuccessful(o.actionResult)) entry.successes++;
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
    case "RUN_RESEARCH_SCAN": {
      const report = await runResearchScan(new Date(), {}, String(params.focus ?? "") || undefined);
      // Phase 43: research hypotheses enter the promotion pipeline as proposals
      // (dedup on objective; one bad hypothesis never blocks the scan).
      let proposalsCreated = 0;
      try {
        proposalsCreated = (await createProposalsFromScan(report)).length;
      } catch (err) {
        console.warn("[command-brain] Proposal creation failed (best-effort):", err instanceof Error ? err.message : String(err));
      }
      return `ok: findings=${report.findings.length} hypotheses=${report.hypotheses.length} proposals=${proposalsCreated} llm_used=${report.llm_used}`;
    }
    case "RUN_EXTERNAL_RESEARCH": {
      const scan = await runExternalResearchScan(new Date(), {}, String(params.focus ?? "") || undefined);
      const injectionFlagged = scan.items.filter((i) => !i.injection_scan.safe).length;
      return `ok: items=${scan.items.length} injection_flagged=${injectionFlagged} llm_used=${scan.llm_used}`;
    }
    default:
      return "error: unknown action";
  }
}

export interface BrainDeps {
  complete?: typeof brainComplete;
  gather?: (now: Date) => Promise<BrainDatapoints>;
  act?: (action: BrainAction, params: Record<string, unknown>) => Promise<string>;
  /** Lease override for tests. `false` disables leasing; otherwise the DB lease is used. */
  lease?: { acquire: () => Promise<{ ownerId: string; release: () => Promise<void> } | null>; release: () => Promise<void> } | false;
}

export interface BrainReport {
  cycle_id: string;
  action: BrainAction;
  params: Record<string, unknown>;
  rationale: string;
  confidence: number;
  executed: boolean;
  action_result: string;
  outcome_class?: BrainOutcomeClass;
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
  "stale discovery -> RUN_DISCOVERY; no recent self-research -> RUN_RESEARCH_SCAN; " +
  "stale outside-world picture -> RUN_EXTERNAL_RESEARCH). Use the " +
  "playbook to favor actions with higher success rates. " +
  'Return STRICT JSON: {"action": "<one of the allowlist>", "params": {..}, "rationale": ' +
  '"<2-3 sentences>", "confidence": <float 0..1>}. No prose outside the JSON object.';

/** Builds a report for cycles that end before/without action execution. */
function skippedReport(
  cycleId: string,
  action: BrainAction,
  actionResult: string,
  outcomeClass: BrainOutcomeClass,
  healthScore: number,
  rationale: string,
  error?: string
): BrainReport {
  return {
    cycle_id: cycleId,
    action,
    params: {},
    rationale,
    confidence: 0,
    executed: false,
    action_result: actionResult,
    outcome_class: outcomeClass,
    health_score: healthScore,
    ...(error ? { error } : {}),
  };
}

/**
 * Runs one brain cycle. Never throws on LLM failure — records the observation and returns a
 * NOOP decision with the reason (fail-closed). Every completed cycle records an OUTCOME,
 * including failures (Phase 40). Lease acquisition fails closed: if the lease cannot be
 * acquired (another live cycle, or lease table unreachable), the cycle is skipped uncoordinated.
 */
export async function runBrainCycle(now: Date = new Date(), deps: BrainDeps = {}): Promise<BrainReport> {
  const cycleId = `brn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const gather = deps.gather ?? gatherDatapoints;
  const act = deps.act ?? defaultAct;
  const complete = deps.complete ?? brainComplete;

  // Phase 40: distributed lease — fail closed when unavailable.
  let lease: BrainLeaseHandle | null = null;
  if (deps.lease !== false) {
    try {
      lease = deps.lease ? await deps.lease.acquire() : await acquireBrainLease();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[command-brain] Lease acquisition failed (fail-closed): ${msg}`);
      return skippedReport(
        cycleId,
        "NOOP",
        "lease_unavailable",
        "ACTION_SKIPPED",
        0,
        `Brain lease unavailable (${msg}); cycle skipped fail-closed.`
      );
    }
    if (!lease) {
      return skippedReport(
        cycleId,
        "NOOP",
        "lease_held_elsewhere",
        "ACTION_SKIPPED",
        0,
        "Another brain cycle holds the lease; this cycle skipped (single-flight)."
      );
    }
  }

  try {
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
      });

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

      // Phase 40: gateway/parser failures are recorded as OUTCOME so outages are
      // visible to the playbook and the audit trail stays complete.
      await prisma.brainMemory
        .create({
          data: {
            cycleId,
            kind: "OUTCOME",
            summary: `${action} -> LLM_UNAVAILABLE: ${error}`.slice(0, 500),
            action,
            actionResult: "LLM_UNAVAILABLE",
          },
        })
        .catch(() => null);

      return {
        cycle_id: cycleId,
        action,
        params,
        rationale,
        confidence,
        executed: false,
        action_result: "LLM_UNAVAILABLE",
        outcome_class: "LLM_UNAVAILABLE",
        health_score: datapoints.health_score,
        ...(error ? { error } : {}),
      };
    }

    // DECISION is recorded whenever the LLM produced a usable decision — even a
    // later-rejected one — so the audit trail shows exactly what was proposed.
    await prisma.brainMemory
      .create({
        data: { cycleId, kind: "DECISION", summary: rationale.slice(0, 500), action, data: params as any },
      });

    // Phase 43: canary SHADOW comparison. If a proposal is in CANARY, its policy
    // decides what IT would do this cycle — recorded as a NOTE, NEVER executed.
    // This is the maximum authority any proposal has in Phase 43.
    try {
      const canary = await getCanaryPolicy();
      if (canary) {
        const policyDecision = decideFromPolicy(
          {
            integrity: datapoints.integrity,
            rails: datapoints.rails,
            disputes_open: datapoints.disputes_open,
            cycles_since_research_scan: null,
          },
          canary.params
        );
        if (policyDecision.action !== action) {
          await prisma.brainMemory
            .create({
              data: {
                cycleId,
                kind: "NOTE",
                summary: `canary-shadow (${canary.proposalId}): policy would ${policyDecision.action}, brain chose ${action}`.slice(0, 500),
                action: policyDecision.action,
                data: { policy_decision: policyDecision, brain_action: action } as object,
              },
            })
            .catch(() => null);
        }
      }
    } catch (err) {
      console.warn("[command-brain] Canary shadow failed (best-effort):", err instanceof Error ? err.message : String(err));
    }

    // Phase 40: strict per-action parameter validation BEFORE execution.
    const paramCheck = validateActionParams(action, params);
    if (!paramCheck.ok) {
      await prisma.brainMemory
        .create({
          data: {
            cycleId,
            kind: "OUTCOME",
            summary: `${action} -> INVALID_PARAMS: ${paramCheck.error}`.slice(0, 500),
            action,
            actionResult: "INVALID_PARAMS",
          },
        })
        .catch(() => null);
      return {
        cycle_id: cycleId,
        action,
        params,
        rationale: rationale || `Params rejected: ${paramCheck.error}`,
        confidence,
        executed: false,
        action_result: "INVALID_PARAMS",
        outcome_class: "INVALID_PARAMS",
        health_score: datapoints.health_score,
        error: paramCheck.error,
      };
    }
    params = paramCheck.params;

    let actionResult = "skipped";
    let executed = false;
    let outcomeClass: BrainOutcomeClass = "ACTION_SKIPPED";
    try {
      if (action === "RECORD_NOTE") {
        await prisma.brainMemory.create({
          data: {
            cycleId,
            kind: "NOTE",
            summary: String(params.note ?? "command brain note").slice(0, 1000),
            action,
            data: params as any,
          },
        });
        actionResult = "ok";
      } else {
        actionResult = await act(action, params);
      }
      executed = isOutcomeSuccessful(actionResult);
      outcomeClass = executed ? "ACTION_SUCCEEDED" : "ACTION_FAILED";
    } catch (err) {
      actionResult = `error: ${err instanceof Error ? err.message : String(err)}`;
      outcomeClass = "ACTION_FAILED";
    }
    await prisma.brainMemory
      .create({
        data: { cycleId, kind: "OUTCOME", summary: `${action} -> ${actionResult}`.slice(0, 500), action, actionResult },
      })
      .catch(() => null);

    return {
      cycle_id: cycleId,
      action,
      params,
      rationale,
      confidence,
      executed,
      action_result: actionResult,
      outcome_class: outcomeClass,
      health_score: datapoints.health_score,
      ...(error ? { error } : {}),
    };
  } finally {
    if (lease) {
      // Phase 41: attribute the previous executed action against measured health
      // deltas before releasing the lease. Learning telemetry — best-effort,
      // never blocks the cycle and never replaces fail-closed audit writes.
      try {
        const attribution = await evaluateRecentOutcomes();
        if (attribution) {
          console.log(
            `[command-brain] Attribution: ${attribution.action} (${attribution.evaluated_cycle_id}) ` +
              `delta=${attribution.delta >= 0 ? "+" : ""}${attribution.delta} ${attribution.result} ` +
              `conf=${attribution.confidence}` +
              (attribution.confounders.length
                ? ` confounders=${attribution.confounders.length}`
                : "")
          );
        }
      } catch (err) {
        console.warn(
          "[command-brain] Attribution failed (best-effort):",
          err instanceof Error ? err.message : String(err)
        );
      }
      try {
        await lease.release();
      } catch (err) {
        console.error(
          "[command-brain] Lease release failed (will expire via TTL):",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
