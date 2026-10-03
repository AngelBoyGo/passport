/**
 * Fleet dispatch scheduler — drives the money-intent executor and the
 * reputation sweep on a cron cadence.
 *
 * Why this exists: the two capabilities below were only reachable via
 * `POST /api/v1/fleet/dispatch`, which nothing called on a timer. The result
 * was that AUTHORIZED money intents sat un-executed forever and reputation
 * tiers never decayed — the fleet's earning loop could never close without a
 * human POSTing the endpoint.
 *
 * This scheduler is the internal trigger. Each underlying tick is already
 * lease-guarded and single-flight (see fleet-executor.ts / reputation-sweep.ts),
 * so running it in-process is safe alongside any external caller. It is
 * operator-gated by FLEET_DISPATCH_ENABLED (default on) and halts cleanly when
 * FLEET_HALT is set — the underlying ticks also re-check the halt themselves.
 *
 * Env:
 *   FLEET_DISPATCH_SCHEDULE — cron expression (default: every 15 minutes)
 *   FLEET_DISPATCH_ENABLED  — set "false" to disable (default: enabled)
 */
import cron, { ScheduledTask } from "node-cron";

const DEFAULT_SCHEDULE = "*/15 * * * *"; // every 15 minutes

let task: ScheduledTask | null = null;

export function startFleetDispatchScheduler(customSchedule?: string): void {
  if (task) {
    console.warn("[fleet-dispatch] Already running; ignoring duplicate start.");
    return;
  }
  if (String(process.env.FLEET_DISPATCH_ENABLED || "").toLowerCase() === "false") {
    console.log("[fleet-dispatch] Disabled via FLEET_DISPATCH_ENABLED=false");
    return;
  }

  const schedule = customSchedule || process.env.FLEET_DISPATCH_SCHEDULE || DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[fleet-dispatch] Invalid cron "${schedule}"; not started.`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    try {
      // Lazy imports keep the DB/executor graph out of the module-load path.
      const { runFleetDispatchTick } = await import("@/lib/fleet/fleet-executor");
      const { runReputationSweepTick } = await import("@/lib/fleet/reputation-sweep");

      const dispatch = await runFleetDispatchTick();
      if (dispatch.report) {
        const { executed, retriable_failures, exhausted } = dispatch.report;
        if (executed.length || retriable_failures.length || exhausted.length) {
          console.log(
            `[fleet-dispatch] executed=${executed.length} retriable=${retriable_failures.length} exhausted=${exhausted.length}`
          );
        }
      }

      const sweep = await runReputationSweepTick().catch(() => ({
        ran_lease: false,
        swept: 0,
        signals_dispatched: [] as Array<{ commitment: string; kind: string; to: string }>,
      }));
      if (sweep.signals_dispatched.length) {
        console.log(`[fleet-dispatch] reputation signals=${sweep.signals_dispatched.length} swept=${sweep.swept}`);
      }
    } catch (err) {
      console.error("[fleet-dispatch] Tick failed:", err instanceof Error ? err.message : String(err));
    }
  });

  console.log(`[fleet-dispatch] Started with schedule "${schedule}"`);
}

export function stopFleetDispatchScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[fleet-dispatch] Stopped.");
  }
}
