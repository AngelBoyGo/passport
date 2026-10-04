/**
 * Moltbook heartbeat scheduler — reads the agent forum on a cadence so the
 * brain learns from it, mirroring Moltbook's own "check every ~30 minutes"
 * guidance. No-ops cleanly when MOLTBOOK_API_KEY is unset.
 *
 * Read-only: this never posts and never executes. Posting is a separate,
 * opt-in capability (MOLTBOOK_POST_ENABLED) deferred to v1.1.
 *
 * Env:
 *   MOLTBOOK_CHECK_SCHEDULE — cron expression (default every 30 minutes)
 *   MOLTBOOK_ENABLED        — "false" to disable (default enabled)
 */
import cron, { ScheduledTask } from "node-cron";

const DEFAULT_SCHEDULE = "*/30 * * * *"; // every 30 minutes

let task: ScheduledTask | null = null;

export function startMoltbookScheduler(customSchedule?: string): void {
  if (task) {
    console.warn("[moltbook] Already running; ignoring duplicate start.");
    return;
  }
  if (String(process.env.MOLTBOOK_ENABLED || "").toLowerCase() === "false") {
    console.log("[moltbook] Disabled via MOLTBOOK_ENABLED=false");
    return;
  }

  const schedule = customSchedule || process.env.MOLTBOOK_CHECK_SCHEDULE || DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[moltbook] Invalid cron "${schedule}"; not started.`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    try {
      const { moltbookConfigured, moltbookRead } = await import("@/lib/brain/moltbook");
      if (!moltbookConfigured()) {
        console.log("[moltbook] Not configured (MOLTBOOK_API_KEY unset); skipping read.");
        return;
      }
      const r = await moltbookRead();
      console.log(`[moltbook] Read ${r.fetched} item(s), stored ${r.stored} new.`);
    } catch (err) {
      console.error("[moltbook] Read failed:", err instanceof Error ? err.message : String(err));
    }
  });

  console.log(`[moltbook] Started with schedule "${schedule}"`);
}

export function stopMoltbookScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[moltbook] Stopped.");
  }
}
