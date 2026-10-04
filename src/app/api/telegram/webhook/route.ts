import { NextRequest, NextResponse } from "next/server";
import { runBrainCycle, BRAIN_ACTIONS, type BrainAction } from "@/lib/brain/command-brain";
import { getFleetStatus } from "@/lib/fleet/fleet-service";
import { prisma } from "@/lib/db";
import {
  type TelegramUpdate,
  parseCommand,
  isCommanderChat,
  sendTelegramMessage,
  commanderChatIds,
  telegramConfigured,
  verifyTelegramSecret,
  COMMANDER_HELP,
} from "@/lib/telegram/commander";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/telegram/webhook — Telegram bot webhook for the Passport Commander.
 *
 * Telegram cannot send a cookie or Bearer token, so integrity is enforced with
 * the documented `X-Telegram-Bot-Api-Secret-Token` header (set at setWebhook
 * time to TELEGRAM_WEBHOOK_SECRET). We ALWAYS return 200 for well-formed updates
 * so Telegram does not retry-storm us; unknown chats get a polite refusal.
 */
export async function POST(request: NextRequest) {
  if (!telegramConfigured()) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503, headers: NO_STORE });
  }
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramSecret(secret, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "bad_secret" }, { status: 401, headers: NO_STORE });
  }

  let update: TelegramUpdate = {};
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  const from = update.message?.from?.username || update.message?.from?.first_name || "unknown";

  if (!chatId) return NextResponse.json({ ok: true }, { headers: NO_STORE });

  // Log the sender (audit + first-run chat-id discovery). Never logs secrets.
  console.log(`[telegram] from=${from} chat_id=${chatId} text=${String(text ?? "").slice(0, 80)}`);

  if (!isCommanderChat(chatId)) {
    await sendTelegramMessage(
      chatId,
      `Not authorized. This chat id is *${chatId}* — ask the operator to add it to TELEGRAM_COMMANDER_CHAT_IDS.`
    );
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const parsed = parseCommand(text);
  if (!parsed) {
    await sendTelegramMessage(chatId, "Send a command, e.g. `/status` or `/brain`. /help for the list.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  try {
    const reply = await handleCommand(parsed.command, parsed.args, from);
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendTelegramMessage(chatId, `⚠️ Command failed: ${message.slice(0, 300)}`);
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

async function handleCommand(command: string, args: string[], from: string): Promise<string> {
  switch (command) {
    case "start":
    case "help":
      return COMMANDER_HELP;

    case "actions":
      return "*Forceable actions:*\n" + BRAIN_ACTIONS.map((a) => `\`${a}\``).join(", ");

    case "watch": {
      const { watchAll, renderFleetWatch } = await import("@/lib/commander/watch");
      const snap = await watchAll();
      // Optional: record the snapshot as telemetry so the brain sees subsystem
      // health history, not just the last Telegram poke.
      await prisma.brainMemory
        .create({
          data: {
            kind: "OBSERVATION",
            summary: `fleet-watch overall=${snap.overall}`,
            data: snap as unknown as object,
            createdAt: new Date(),
          },
        })
        .catch(() => null);
      return renderFleetWatch(snap);
    }

    case "market": {
      const { renderMarketplace } = await import("@/lib/commander/watch");
      return await renderMarketplace();
    }

    case "status": {
      const [fleet, lastCycle] = await Promise.all([
        getFleetStatus(),
        prisma.brainMemory
          .findFirst({ orderBy: { createdAt: "desc" }, where: { kind: "DECISION" } })
          .catch(() => null),
      ]);
      const statusLines = Object.entries(fleet.byStatus)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n") || "  (none)";
      const last = lastCycle
        ? `Last decision: *${lastCycle.action ?? "?"}* (${lastCycle.actionResult ?? "?"}) @ ${lastCycle.createdAt?.toISOString?.() ?? ""}`
        : "No brain decisions recorded yet.";
      return [
        "*Passport status*",
        `Health: ${fleet.halt ? "🛑 HALTED" : "🟢 running"}`,
        `Fleet total: ${fleet.total}/${fleet.cap}`,
        `Money mint enabled: ${fleet.moneyMintEnabled ? "yes" : "no"}`,
        statusLines,
        "",
        last,
      ].join("\n");
    }

    case "fleet": {
      const fleet = await getFleetStatus();
      const tiers = Object.entries(fleet.byTier)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n") || "  (none)";
      return [
        "*Fleet roster*",
        `Total: ${fleet.total}/${fleet.cap}`,
        "*By tier:*",
        tiers,
        "*By status:*",
        Object.entries(fleet.byStatus).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  (none)",
      ].join("\n");
    }

    case "brain": {
      const forced = args[0]?.toUpperCase();
      if (forced && forced === "REQUEST_MONEY_INTENT") {
        return "🔒 Money-intent actions are refused from chat. Use the executive console (signature required).";
      }
      if (forced && !BRAIN_ACTIONS.includes(forced as BrainAction)) {
        return `Unknown action \`${forced}\`. /actions to list.`;
      }
      const report = forced
        ? await runBrainCycle(new Date(), {
            complete: async () =>
              JSON.stringify({
                action: forced,
                params: {},
                rationale: `Telegram Commander (${from}) forced ${forced}`,
                confidence: 1.0,
              }),
          })
        : await runBrainCycle();

      await prisma.adminAuditLog
        .create({
          data: {
            operatorId: "telegram-commander",
            action: "brain_cycle_telegram_trigger",
            targetId: report.cycle_id,
            details: `From:${from} Action:${report.action} (${report.action_result}) Health:${report.health_score}`,
          },
        })
        .catch(() => null);

      return [
        "*Brain cycle complete*",
        `Action: *${report.action}*`,
        `Result: ${report.action_result}`,
        `Health: ${report.health_score}`,
        `Cycle: \`${report.cycle_id}\``,
      ].join("\n");
    }

    case "jobs":
      return "_Job pipeline lives in the Callora boundary. Use `/brain RUN_LOCUM_SEARCH` to kick a search; results land in the Callora apply view._";

    case "missions": {
      const { listActiveMissions, getCurrentPlan } = await import("@/lib/brain/mission-service");
      const active = await listActiveMissions(10);
      if (active.length === 0) {
        return "*Missions:* none active yet. The brain authors one on its next cycle, or use `/plan`.";
      }
      const lines = await Promise.all(
        active.map(async (m) => {
          const plan = await getCurrentPlan(m.missionId).catch(() => null);
          const next = plan?.steps.find((s) => !s.done);
          return `\`${m.missionId}\` [P${m.priority}] *${m.title}*\n  ${next ? `next: ${next.action}` : "no committed step"}`;
        })
      );
      return ["*Active missions*", ...lines, "", "`/mission <id>` for detail · `/plan` to re-plan"].join("\n");
    }

    case "mission": {
      const id = String(args[0] ?? "").trim();
      if (!id) return "Usage: `/mission <mission_id>`";
      const { getMission, getCurrentPlan } = await import("@/lib/brain/mission-service");
      const m = await getMission(id);
      if (!m) return `Mission \`${id}\` not found.`;
      const plan = await getCurrentPlan(id).catch(() => null);
      const steps = plan
        ? plan.steps.map((s) => `  ${s.done ? "✓" : "•"} ${s.step}. ${s.action} — ${s.rationale.slice(0, 100)}`).join("\n")
        : "  (no committed plan)";
      return [
        `*${m.title}*`,
        `Status: ${m.status} · Priority ${m.priority} · by ${m.originPersona}`,
        `Objective: ${m.objective}`,
        m.thesis ? `Thesis: ${m.thesis}` : "",
        "*Plan:*",
        steps,
      ].filter(Boolean).join("\n");
    }

    case "plan": {
      const { listActiveMissions, getCurrentPlan, createMission, commitPlan } = await import("@/lib/brain/mission-service");
      const { runMissionDialogue } = await import("@/lib/brain/dialogue");
      const { gatherDatapoints } = await import("@/lib/brain/command-brain");
      const dps = await gatherDatapoints(new Date());
      let active = await listActiveMissions(5);
      if (active.length === 0) {
        const created = await createMission({
          title: "Prove the earning loop end-to-end",
          objective: "Land a first externally-paid engagement and record the revenue",
          thesis: "Operator-seeded genesis mission for the dialogue loop.",
          priority: 70,
          originPersona: "muse",
          evidenceRefs: { source: "telegram_seed" },
        });
        if (created.ok) active = [created.mission];
      }
      const m = active[0];
      if (!m) return "No mission available to plan.";
      const plan = await getCurrentPlan(m.missionId).catch(() => null);
      const result = await runMissionDialogue({
        missionId: m.missionId,
        title: m.title,
        objective: m.objective,
        thesis: m.thesis,
        datapoints: dps as unknown as Record<string, unknown>,
        openSteps: plan ? plan.steps.filter((s) => !s.done) : [],
      });
      if (!result.ok) return `Dialogue did not commit a plan: ${result.reason}`;
      await commitPlan({
        missionId: m.missionId,
        steps: result.steps,
        dialogue: result.turns,
        createdByPersona: result.draftedBy,
        committedStep: result.committedStep,
      });
      return [
        "*Dialogue complete*",
        `Mission: ${m.title}`,
        result.steps.map((s) => `  ${s.step}. ${s.action} — ${s.rationale.slice(0, 110)}`).join("\n"),
      ].join("\n");
    }

    case "moltbook": {
      const { moltbookConfigured, moltbookRead, recentMoltbookItems } = await import("@/lib/brain/moltbook");
      if (!moltbookConfigured()) {
        return "Moltbook not configured. Register + set `MOLTBOOK_API_KEY` from the admin console first.";
      }
      await moltbookRead().catch(() => null);
      const items = await recentMoltbookItems(5);
      const lines = items.map((i) => `  • ${(i.title ?? i.body).slice(0, 90)}${i.injectionScan.safe ? "" : " ⚠️(injection)"}`);
      return ["*Moltbook (latest learned)*", lines.join("\n") || "  (nothing stored yet)"].join("\n");
    }

    case "ask": {
      // Operator asks the brain a direct question. The brain answers from its
      // live resources (economy, fleet, missions, Moltbook, memory).
      const question = args.join(" ").trim();
      if (!question) return "Usage: `/ask <your question>` — the brain answers from its live resources.";
      const { askBrain } = await import("@/lib/brain/ask");
      const r = await askBrain(question);
      return r.ok ? `🧠 ${r.answer}` : `⚠️ Brain could not answer: ${r.reason}`;
    }

    case "task": {
      // Operator assigns a task; it becomes an OPERATOR-authored mission.
      const instruction = args.join(" ").trim();
      if (!instruction) return "Usage: `/task <what you want the brain to pursue>` — creates a top-priority mission.";
      const { assignTask } = await import("@/lib/brain/ask");
      const r = await assignTask(instruction);
      if (!r.ok) return `⚠️ Could not create task: ${r.reason}`;
      return [
        "*Task assigned* ✅",
        `Mission: \`${r.missionId}\``,
        `Title: ${r.title}`,
        "",
        "The two-persona dialogue will plan it on the next cycle; use `/plan` to force planning now, `/missions` to track.",
      ].join("\n");
    }

    case "mars":
    case "muse": {
      // Talk to ONE persona directly (its own voice + model).
      const personaId = command === "mars" ? "mars" : "muse";
      const question = args.join(" ").trim();
      if (!question) {
        return `Usage: \`/${command} <question>\` — ask ${personaId.toUpperCase()} directly.`;
      }
      const { askPersona } = await import("@/lib/brain/ask");
      const r = await askPersona(personaId, question);
      if (!r.ok) return `⚠️ ${personaId.toUpperCase()} could not answer: ${r.reason}`;
      const glyph = personaId === "mars" ? "⚔️" : "🎨";
      return `${glyph} *${r.persona}* ${r.answer}`;
    }

    case "directives": {
      const { recentOperatorDirectives } = await import("@/lib/brain/ask");
      const rows = await recentOperatorDirectives(8);
      if (rows.length === 0) return "*Operator directives:* none yet. Use `/ask` or `/task`.";
      const lines = rows.map((r) => `• [${r.action}] ${String(r.details ?? r.targetId ?? "").slice(0, 90)}`);
      return ["*Recent operator directives*", ...lines].join("\n");
    }

    default:
      return `Unknown command \`/${command}\`. /help for the list.`;
  }
}

/** GET — lets the operator verify the endpoint is deployed (does NOT expose config). */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "passport-telegram-commander",
      configured: telegramConfigured(),
      allowlistedChats: commanderChatIds().length,
    },
    { headers: NO_STORE }
  );
}
