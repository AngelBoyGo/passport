/**
 * Best-effort push notifications to the Telegram Commander chat(s).
 *
 * The Commander already REPLIES to inbound commands; this is for events the
 * brain produces on its own — missions authored, dialogue plans committed — so
 * the owner sees activity without having to ask. Never throws: a Telegram
 * outage must not affect a brain cycle.
 */
import { sendTelegramMessage, commanderChatIds, telegramConfigured } from "@/lib/telegram/commander";

/** Sends `text` to every allowlisted commander chat. Never throws. */
export async function notifyCommander(text: string): Promise<void> {
  try {
    if (!telegramConfigured()) return;
    const ids = commanderChatIds();
    if (ids.length === 0) return;
    for (const chatId of ids) {
      await sendTelegramMessage(chatId, text);
    }
  } catch {
    // Notifications are best-effort; swallow any transport error.
  }
}
