/**
 * Operator ↔ Brain communication.
 *
 * The Command Brain is supposed to reason over the resources the operator made
 * for it — the economy, the fleet, the marketplace, its missions, and the
 * outside world (Moltbook). This module gives the operator a direct line to the
 * brain from Telegram:
 *
 *   ask(question)  — the brain answers a direct question, grounded in its live
 *                    resources + recent memory + active missions + Moltbook.
 *   assignTask()   — the operator hands the brain a task; it becomes an
 *                    OPERATOR-authored mission (highest priority) that the
 *                    two-persona dialogue will plan and the cycle will advance.
 *
 * Answers never execute anything and never move money — they are read + reason.
 * Tasks create a mission (intent), which still goes through the normal planning
 * + allowlist + param validation before any action runs.
 */

import { prisma } from "@/lib/db";
import { brainComplete } from "@/lib/raillab/factory-brain";
import { gatherDatapoints } from "@/lib/brain/command-brain";
import { listActiveMissions, getCurrentPlan, createMission } from "@/lib/brain/mission-service";
import { recentMoltbookItems } from "@/lib/brain/moltbook";
import { parseConfidenceMarker } from "@/lib/brain/dialogue";

export interface BrainResourceBundle {
  datapoints: Record<string, unknown>;
  missions: Array<{ missionId: string; title: string; objective: string; status: string; nextStep: string | null }>;
  moltbook: Array<{ title: string; body: string; author: string | null; safe: boolean }>;
  recentMemory: Array<{ kind: string; summary: string }>;
}

/**
 * Assembles the full resource picture the brain reasons over. Single source of
 * truth for both the ask endpoint and the dialogue context. Best-effort per
 * source: a failure omits that section rather than breaking the bundle.
 */
export async function gatherBrainResources(): Promise<BrainResourceBundle> {
  const datapoints = await gatherDatapoints(new Date()).catch(
    () => ({}) as Record<string, unknown>
  ) as unknown as Record<string, unknown>;

  const missions = await (async () => {
    try {
      const active = await listActiveMissions(8);
      return Promise.all(
        active.map(async (m) => {
          const plan = await getCurrentPlan(m.missionId).catch(() => null);
          const next = plan?.steps.find((s) => !s.done);
          return {
            missionId: m.missionId,
            title: m.title,
            objective: m.objective,
            status: m.status,
            nextStep: next ? `${next.action}: ${next.rationale.slice(0, 120)}` : null,
          };
        })
      );
    } catch {
      return [];
    }
  })();

  const moltbook = await recentMoltbookItems(8)
    .then((items) =>
      items.map((i) => ({ title: i.title ?? "", body: i.body.slice(0, 300), author: i.author, safe: i.injectionScan.safe }))
    )
    .catch(() => []);

  const recentMemory = await prisma.brainMemory
    .findMany({ orderBy: { createdAt: "desc" }, take: 12, select: { kind: true, summary: true } })
    .catch(() => [] as { kind: string; summary: string }[]);

  return { datapoints, missions, moltbook, recentMemory };
}

/**
 * The operator asks the brain a question; the brain answers using its live
 * resources. Uses the neuron tier (the brain's primary model). Read-only.
 */
export async function askBrain(question: string): Promise<{ ok: true; answer: string } | { ok: false; reason: string }> {
  const q = question.trim();
  if (!q) return { ok: false, reason: "empty_question" };

  const resources = await gatherBrainResources();

  try {
    const raw = await brainComplete({
      system:
        "You are the Passport Command Brain — the supervisor of a commodity-backed autonomous-agent " +
        "economy. The operator (your owner) is asking you a direct question. Answer concisely and " +
        "honestly, grounded ONLY in the resources given: the live economy datapoints, your active " +
        "missions and their next steps, recent memory, and what you have read on Moltbook. " +
        "If the resources do not contain the answer, say so plainly. You may propose what you would " +
        "do next, but you cannot execute or move money. Use 2-6 sentences. Plain text, no markdown " +
        "headers.",
      user: JSON.stringify({ question: q, resources }),
      json: false,
      temperature: 0.3,
    });
    const answer = raw.trim();
    if (!answer) return { ok: false, reason: "empty_completion" };
    await audit("brain_ask", q.slice(0, 200), answer.slice(0, 400));
    return { ok: true, answer };
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

/**
 * The operator assigns a task. It becomes an OPERATOR-authored mission at the
 * highest priority, which the dialogue will plan and the cycle will advance.
 * Respects the active-mission cap (fail-closed: reports the cap rather than
 * silently dropping the task).
 */
export async function assignTask(
  instruction: string
): Promise<{ ok: true; missionId: string; title: string } | { ok: false; reason: string }> {
  const text = instruction.trim();
  if (!text) return { ok: false, reason: "empty_instruction" };

  const title = text.split(/[.\n]/)[0].slice(0, 80).trim() || "Operator task";
  const created = await createMission({
    title,
    objective: text.slice(0, 800),
    thesis: "Assigned directly by the operator via Telegram.",
    priority: 95,
    originPersona: "mars",
    evidenceRefs: { source: "operator_telegram", assignedAt: new Date().toISOString() },
    createdBy: "operator",
  });
  if (!created.ok) return { ok: false, reason: created.reason };
  await audit("brain_task_assigned", title, text.slice(0, 400));
  // Push the assignment to Telegram (covers tasks assigned outside the /task
  // command path too, e.g. the API/console).
  const { notifyCommander } = await import("@/lib/telegram/notify");
  await notifyCommander(
    `📋 *Task assigned*\n${created.mission.title}\n\`${created.mission.missionId}\`\nThe dialogue will plan it next cycle.`
  );
  return { ok: true, missionId: created.mission.missionId, title: created.mission.title };
}

/**
 * The operator addresses ONE persona directly (MARS or MUSE). The persona
 * answers in its own voice on its own model, grounded in the same live
 * resources. This is how you talk to each half of the brain separately.
 */
export async function askPersona(
  personaId: "mars" | "muse" | "more",
  question: string
): Promise<
  | { ok: true; answer: string; persona: string; confidence: number | null }
  | { ok: false; reason: string }
> {
  const q = question.trim();
  if (!q) return { ok: false, reason: "empty_question" };

  const resources = await gatherBrainResources();

  try {
    const { PERSONAS, personaModel } = await import("@/lib/brain/personas");
    const { resolveAllowlistedModel } = await import("@/lib/llm/tiers");
    const persona = PERSONAS[personaId];
    const model = resolveAllowlistedModel(persona.tier, personaModel(persona));
    // AUDIT FIX (F7): direct asks must NOT inherit the strict-JSON action
    // contract — it contradicts the plain-text + confidence-marker request and
    // made models return raw JSON (so confidence was always null). Strip the
    // contract for this path.
    const { ACTION_CONTRACT } = await import("@/lib/brain/personas");
    const plainSystem = persona.systemPrompt.replace(ACTION_CONTRACT, "").trim();
    const raw = await brainComplete({
      system:
        plainSystem +
        " The operator (your owner) is speaking to YOU directly. Answer in your own voice, " +
        "grounded ONLY in the resources given. Be concise (2-5 sentences). Reply in PLAIN TEXT " +
        "(no JSON). End your reply with exactly: CONFIDENCE: <0-100>.",
      user: JSON.stringify({ question: q, resources }),
      tier: persona.tier,
      model,
      temperature: persona.temperature,
      ...(persona.tier === "local" ? { reasoningEffort: "none" as const, maxTokens: 256 } : {}),
      json: false,
    });
    const { text, confidence } = parseConfidenceMarker(raw.trim());
    if (!text) return { ok: false, reason: "empty_completion" };
    await audit(`brain_ask_${personaId}`, q.slice(0, 200), text.slice(0, 400));
    return { ok: true, answer: text, persona: persona.name, confidence };
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

/** Recent operator directives (asks + tasks) for the admin/audit view. */
export async function recentOperatorDirectives(limit = 10) {
  return prisma.adminAuditLog
    .findMany({
      where: { action: { in: ["brain_ask", "brain_ask_mars", "brain_ask_muse", "brain_ask_more", "brain_task_assigned"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { action: true, targetId: true, details: true, createdAt: true },
    })
    .catch(() => []);
}

async function audit(action: string, targetId: string, details: string): Promise<void> {
  await prisma.adminAuditLog
    .create({ data: { operatorId: "telegram-commander", action, targetId, details: details.slice(0, 500) } })
    .catch(() => undefined);
}
