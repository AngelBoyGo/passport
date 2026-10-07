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
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of the Telegram webhook secret. Fails closed when
 * either side is empty. Prevents a timing oracle on the shared secret.
 */
export function verifyTelegramSecret(provided: string | null, expected: string | undefined): boolean {
  const a = provided ?? "";
  const b = expected ?? "";
  if (!a || !b) return false;
  try {
    // Compare BYTE lengths (not UTF-16 code units): a multibyte input can match
    // on `.length` but differ in bytes, which makes timingSafeEqual throw. Any
    // mismatch or error must fail closed (401), never 500.
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export type TelegramUpdate = {
  /** Monotonic per-bot id; used to drop Telegram retries (at-least-once delivery). */
  update_id?: number;
  message?: {
    chat?: { id?: number };
    from?: { id?: number; username?: string; first_name?: string };
    text?: string;
  };
};

/**
 * Idempotency for Telegram's at-least-once webhook delivery. Telegram retries an
 * update when it does not receive a timely 2xx (long /brain or /plan commands can
 * exceed its timeout), which would otherwise re-run a cycle, a dialogue, or
 * create duplicate missions. Returns true the FIRST time an update_id is seen
 * (within the TTL), false on a replay. In-process + bounded (single replica).
 */
const seenUpdates = new Map<number, number>();
const UPDATE_TTL_MS = 10 * 60_000;
const MAX_SEEN_UPDATES = 5000;

export function claimTelegramUpdate(updateId: number | undefined): boolean {
  if (updateId === undefined || updateId === null) return true;
  const now = Date.now();
  if (seenUpdates.size >= MAX_SEEN_UPDATES) {
    for (const [k, exp] of seenUpdates) if (exp <= now) seenUpdates.delete(k);
    // Still full (all live): drop oldest-inserted to stay bounded.
    while (seenUpdates.size >= MAX_SEEN_UPDATES) {
      const oldest = seenUpdates.keys().next().value;
      if (oldest === undefined) break;
      seenUpdates.delete(oldest);
    }
  }
  const existing = seenUpdates.get(updateId);
  if (existing !== undefined && existing > now) return false;
  seenUpdates.set(updateId, now + UPDATE_TTL_MS);
  return true;
}

/**
 * Per-chat inbound throttle. Expensive commands (/brain, /plan, /ask, personas)
 * each cost LLM spend / run a cycle; without a cap a compromised allowlisted
 * device (or a replay) can burn budget. Sliding window, in-process.
 */
const cmdWindows = new Map<string, number[]>();
const CMD_LIMIT = 20;
const CMD_WINDOW_MS = 60_000;

export function allowTelegramCommand(chatId: number | string): boolean {
  const key = String(chatId);
  const now = Date.now();
  const recent = (cmdWindows.get(key) ?? []).filter((t) => now - t < CMD_WINDOW_MS);
  if (recent.length >= CMD_LIMIT) {
    cmdWindows.set(key, recent);
    return false;
  }
  recent.push(now);
  cmdWindows.set(key, recent);
  return true;
}

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
  const base = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  };
  const url = `${API}/bot${token}/sendMessage`;
  const headers = { "Content-Type": "application/json" };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...base, parse_mode: "Markdown" }),
    });
    if (r.ok) return true;
    // Legacy Markdown rejects the ENTIRE message on unbalanced entities (e.g. a
    // mission title containing '*'). Retry as plain text so a reply is never
    // silently dropped (Telegram sees our 200 and would not resend).
    const r2 = await fetch(url, { method: "POST", headers, body: JSON.stringify(base) });
    return r2.ok;
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
  "`/ask <question>` — ask the brain directly; it answers from its live resources",
  "`/mars <question>` — ask MARS (aggressive/calculating half) directly",
  "`/muse <question>` — ask MUSE (creative/experimental half) directly",
  "`/more <question>` — ask MORE (self-hosted synthesizer, gemma-4) directly",
  "`/task <instruction>` — assign the brain a top-priority mission",
  "`/directives` — recent operator asks/tasks the brain has been given",
  "`/brain` — run one autonomous Command Brain cycle now",
  "`/brain <ACTION>` — force a specific action (e.g. `/brain RUN_LOCUM_SEARCH`)",
  "`/missions` — active missions + their committed next step",
  "`/mission <id>` — detail for one mission",
  "`/plan` — run a two-persona Plan→Critique→Revise dialogue now",
  "`/moltbook` — Moltbook read status + latest learned items",
  "`/actions` — list forceable actions",
  "`/jobs` — recent locum apply/RTR pipeline (via Callora boundary)",
  "`/help` — this message",
  "",
  "_Money actions require the console + signature and are refused from chat._",
].join("\n");
