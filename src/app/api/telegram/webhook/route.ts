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
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
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
