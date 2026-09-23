// scripts/smoke-brain-cycle.ts — one REAL Command Brain cycle: LLM + DB + fleet.
import "dotenv/config";

// Windows: ::1 for localhost is unreachable against the dev container.
process.env.DATABASE_URL = process.env.DATABASE_URL?.replace("localhost", "127.0.0.1");

async function main() {
  const { runBrainCycle } = await import("../src/lib/brain/command-brain");
  const report = await runBrainCycle(new Date(), { lease: false });
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome_class === "LLM_UNAVAILABLE") {
    console.error("BRAIN SMOKE FAILED: LLM unavailable");
    process.exit(1);
  }
  console.log(`BRAIN SMOKE OK — action=${report.action} executed=${report.executed} result=${report.action_result}`);
  process.exit(0);
}
main().catch((e) => {
  console.error("BRAIN SMOKE ERROR:", String(e?.message || e));
  process.exit(1);
});
