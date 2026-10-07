/**
 * Fleet-watch scheduler — periodically checks every earning subsystem and
 * posts the digest to the owner's Telegram. This is what makes the Commander
 * "report to me while running autonomously": the owner does not have to ask.
 *
 * Env:
 *   FLEET_WATCH_SCHEDULE — cron expression (default every 6 hours)
 *   TELEGRAM_COMMANDER_CHAT_IDS — recipients (first id is used)
 *
 * No-ops cleanly when Telegram is unconfigured, so it is safe to leave enabled.
 */
import cron, { ScheduledTask } from "node-cron";
import { schedulersAllowed } from "@/lib/scheduler/guard";
import { acquireLease, type LeaseHandle } from "@/lib/scheduler/lease";

const DEFAULT_SCHEDULE = "0 */6 * * *"; // every 6 hours

/** Lease id guarding the digest — prevents duplicate Telegram messages across replicas. */
export const FLEET_WATCH_LEASE_ID = "fleet-watch";

let task: ScheduledTask | null = null;

/**
 * One fleet-watch digest. Lease-guarded single-flight, fail-closed: if another
 * replica holds the lease (or the lease store is unreachable) it skips, so the
 * owner never receives the same digest N times from N replicas.
 */
export async function runFleetWatchDigest(): Promise<void> {
  let lease: LeaseHandle | null = null;
  try {
    lease = await acquireLease(FLEET_WATCH_LEASE_ID);
  } catch (err) {
    console.error(
      "[fleet-watch] Lease unavailable (fail-closed):",
      err instanceof Error ? err.message : String(err)
    );
    return;
  }
  if (!lease) {
    console.log("[fleet-watch] Skipped — another instance holds the lease (single-flight).");
    return;
  }
  try {
    const { watchAll, renderFleetWatch } = await import("@/lib/commander/watch");
    const { sendTelegramMessage, commanderChatIds, telegramConfigured } =
      await import("@/lib/telegram/commander");
    if (!telegramConfigured() || commanderChatIds().length === 0) {
      console.log("[fleet-watch] Telegram not configured; skipping digest.");
      return;
    }
    const snap = await watchAll();
    const text = renderFleetWatch(snap);
    for (const chatId of commanderChatIds()) {
      await sendTelegramMessage(chatId, text);
    }
    console.log(`[fleet-watch] Digest sent (overall=${snap.overall})`);
  } catch (err) {
    console.error("[fleet-watch] Digest failed:", err instanceof Error ? err.message : String(err));
  } finally {
    try {
      await lease.release();
    } catch (err) {
      console.error(
        "[fleet-watch] Lease release failed (will expire via TTL):",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

export function startFleetWatchScheduler(customSchedule?: string): void {
  if (task) {
    console.warn("[fleet-watch] Already running; ignoring duplicate start.");
    return;
  }
  const gate = schedulersAllowed();
  if (!gate.allowed) {
    console.log(`[fleet-watch] Not started: ${gate.reason}`);
    return;
  }
  if (process.env.FLEET_WATCH_ENABLED === "false") {
    console.log("[fleet-watch] Disabled via FLEET_WATCH_ENABLED=false");
    return;
  }

  const schedule = customSchedule || process.env.FLEET_WATCH_SCHEDULE || DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[fleet-watch] Invalid cron "${schedule}"; not started.`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    await runFleetWatchDigest();
  });

  console.log(`[fleet-watch] Started with schedule "${schedule}"`);
}

export function stopFleetWatchScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[fleet-watch] Stopped.");
  }
}
