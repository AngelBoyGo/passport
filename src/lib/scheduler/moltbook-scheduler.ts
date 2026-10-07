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
import { schedulersAllowed } from "@/lib/scheduler/guard";
import { acquireLease, type LeaseHandle } from "@/lib/scheduler/lease";

const DEFAULT_SCHEDULE = "*/30 * * * *"; // every 30 minutes

/** Lease id guarding the read — prevents duplicate reads/writes across replicas. */
export const MOLTBOOK_LEASE_ID = "moltbook-read";

let task: ScheduledTask | null = null;

/**
 * One Moltbook read pass. Lease-guarded single-flight, fail-closed: the read
 * writes a BrainMemory row + AgentEvidence per item, so running it on every
 * replica would duplicate that history. Only one replica runs it.
 */
export async function runMoltbookRead(): Promise<void> {
  let lease: LeaseHandle | null = null;
  try {
    lease = await acquireLease(MOLTBOOK_LEASE_ID);
  } catch (err) {
    console.error(
      "[moltbook] Lease unavailable (fail-closed):",
      err instanceof Error ? err.message : String(err)
    );
    return;
  }
  if (!lease) {
    console.log("[moltbook] Skipped — another instance holds the lease (single-flight).");
    return;
  }
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
  } finally {
    try {
      await lease.release();
    } catch (err) {
      console.error(
        "[moltbook] Lease release failed (will expire via TTL):",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

export function startMoltbookScheduler(customSchedule?: string): void {
  if (task) {
    console.warn("[moltbook] Already running; ignoring duplicate start.");
    return;
  }
  const gate = schedulersAllowed();
  if (!gate.allowed) {
    console.log(`[moltbook] Not started: ${gate.reason}`);
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
    await runMoltbookRead();
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
