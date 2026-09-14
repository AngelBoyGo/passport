/**
 * Revenue bridge runner — auto-sells submitted pipeline jobs by crediting simulated
 * external revenue. In production a real external partner would POST /agent-revenue;
 * this runner closes the loop for dev/staging adoption tests and the proof loop.
 *
 * Env:
 *   REVENUE_RUNNER_SCHEDULE — cron expression (default: every 15 minutes)
 *   REVENUE_RUNNER_ENABLED — set "1" to activate (default off in prod)
 *   AUTOMATED_REVENUE_USD_CENTS — per-job fake revenue in cents (default 500 = $5.00)
 */
import cron, { ScheduledTask } from "node-cron";
import { prisma } from "@/lib/db";
import { creditExternalRevenue } from "@/lib/agent-economy/revenue-bridge";

const DEFAULT_SCHEDULE = "*/15 * * * *";
const DEFAULT_FAKE_REVENUE_CENTS = 500;

let task: ScheduledTask | null = null;

export function startRevenueRunner(customSchedule?: string): void {
  if (task) {
    console.warn("[revenue-runner] Already running; ignoring duplicate start.");
    return;
  }

  if (process.env.REVENUE_RUNNER_ENABLED !== "1") {
    console.log("[revenue-runner] Disabled (REVENUE_RUNNER_ENABLED != 1).");
    return;
  }

  const schedule = customSchedule || process.env.REVENUE_RUNNER_SCHEDULE || DEFAULT_SCHEDULE;

  if (!cron.validate(schedule)) {
    console.error(`[revenue-runner] Invalid cron expression "${schedule}"; not started.`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    try {
      const jobs = await prisma.pipelineJob.findMany({
        where: { status: "SUBMITTED" },
        take: 20,
      });

      for (const job of jobs) {
        const cents =
          Number(process.env.AUTOMATED_REVENUE_USD_CENTS) || DEFAULT_FAKE_REVENUE_CENTS;

        const result = await creditExternalRevenue(
          {
            agentCommitment: job.agentCommitment,
            source: "revenue_runner",
            externalRef: `runner-${job.jobId}`,
            grossUsdCents: cents,
            pipelineJobId: job.jobId,
          },
          { trusted: true }
        );

        if (result.ok) {
          console.log(
            `[revenue-runner] Job ${job.jobId}: credited ${result.angelCredited} ANGEL (${result.deduped ? "deduped" : "new"})`
          );
        } else {
          console.warn(`[revenue-runner] Job ${job.jobId} failed: ${result.error}`);
        }
      }

      if (jobs.length === 0) {
        console.log("[revenue-runner] No SUBMITTED pipeline jobs found.");
      }
    } catch (err) {
      console.error("[revenue-runner] Run failed:", err instanceof Error ? err.message : String(err));
    }
  });

  console.log(`[revenue-runner] Started with schedule "${schedule}"`);
}

export function stopRevenueRunner(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[revenue-runner] Stopped.");
  }
}