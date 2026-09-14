/**
 * Brain Scheduler — runs the Command Brain cycle on a configurable cron cadence.
 *
 * The brain observes system datapoints, decides one bounded action, and records memory.
 * This scheduler ensures it runs regularly without external polling.
 *
 * Env:
 *   BRAIN_SCHEDULE — cron expression (default: every 10 minutes)
 *   SCHEDULER_SECRET — must be set for the brain cycle endpoint to authenticate
 */
import cron, { ScheduledTask } from "node-cron";
import { runBrainCycle } from "@/lib/brain/command-brain";

const DEFAULT_SCHEDULE = "*/10 * * * *";

let task: ScheduledTask | null = null;

export function startBrainScheduler(customSchedule?: string): void {
  if (task) {
    console.warn("[brain-scheduler] Already running; ignoring duplicate start.");
    return;
  }

  const schedule = customSchedule || process.env.BRAIN_SCHEDULE || DEFAULT_SCHEDULE;

  if (!cron.validate(schedule)) {
    console.error(`[brain-scheduler] Invalid cron expression "${schedule}"; brain scheduler not started.`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    try {
      const report = await runBrainCycle();
      console.log(
        `[brain-scheduler] Cycle ${report.cycle_id}: ${report.action} (health=${report.health_score})`
      );
    } catch (err) {
      console.error("[brain-scheduler] Cycle failed:", err instanceof Error ? err.message : String(err));
    }
  });

  console.log(`[brain-scheduler] Started with schedule "${schedule}"`);
}

export function stopBrainScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[brain-scheduler] Stopped.");
  }
}