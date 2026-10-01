/**
 * Telegram Commander — a thin, allowlisted bridge between a Telegram chat and
 * the Passport Command Brain. The bot is NOT a new control plane: every command
 * funnels into the SAME choke points the executive console uses
 * (`runBrainCycle`, `getFleetStatus`, `listFleet`), so authz, audit and money
 * gates are identical whether you trigger from a browser or a phone.
 *
 * Security model:
 *  - Requests must carry Telegram's `X-Telegram-Bot-Api-Secret-Token` matching
 *    TELEGRAM_WEBHOOK_SECRET. Without it the route 401s (the webhook is public
 *    by necessity — secret-token is the documented Telegram integrity control).
 *  - Only chat ids in TELEGRAM_COMMANDER_CHAT_IDS may issue commands.
 *  - Money-tier actions (REQUEST_MONEY_INTENT) are refused from chat; they
 *    require the console + an Ed25519 signature, unchanged.
 */

const API = "https://api.telegram.org";

export type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    from?: { id?: number; username?: string; first_name?: string };
    text?: string;
  };
};

/** Chat ids permitted to command the fleet (comma-separated env). */
export function commanderChatIds(): string[] {
  return (process.env.TELEGRAM_COMMANDER_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isCommanderChat(chatId: number | string | undefined): boolean {
  if (chatId === undefined || chatId === null) return false;
  return commanderChatIds().includes(String(chatId));
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
}

export async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const r = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type ParsedCommand = { command: string; args: string[] };

/** Parse "/brain RUN_LOCUM_SEARCH" -> { command:'brain', args:['RUN_LOCUM_SEARCH'] } */
export function parseCommand(text: string | undefined): ParsedCommand | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  // Strip a trailing @BotName that Telegram appends in groups.
  const [head, ...rest] = trimmed.split(/\s+/);
  const command = head.replace(/^\//, "").split("@")[0].toLowerCase();
  return { command, args: rest };
}

export const COMMANDER_HELP = [
  "*Passport Commander* — commands",
  "`/status` — brain health, fleet counts, halt state",
  "`/watch` — check every earning system (Callora, Medora, Marketplace, Passport)",
  "`/market` — the Marketplace (Metis) job/fleet/escrow digest",
  "`/fleet` — roster summary (active/stopped, earned)",
  "`/brain` — run one autonomous Command Brain cycle now",
  "`/brain <ACTION>` — force a specific action (e.g. `/brain RUN_LOCUM_SEARCH`)",
  "`/actions` — list forceable actions",
  "`/jobs` — recent locum apply/RTR pipeline (via Callora boundary)",
  "`/help` — this message",
  "",
  "_Money actions require the console + signature and are refused from chat._",
].join("\n");
