// scripts/smoke-locum-capability.ts — the REAL brain capability cycle:
// Passport brain -> callora-fleet-client -> Callora /api/fleet/* (local).
import "dotenv/config";

process.env.DATABASE_URL = process.env.DATABASE_URL?.replace("localhost", "127.0.0.1");

async function main() {
  const { runLocumJobSearchCycle } = await import("../src/lib/fleet/locum-capability");
  const r = await runLocumJobSearchCycle({
    candidateName: process.env.PILOT_CANDIDATE_NAME || "Ishmael A Avery",
    payFloor: 350,
  });
  console.log(JSON.stringify(r, null, 2));
  console.log(r.ok ? "LOCUM CAPABILITY SMOKE OK" : `LOCUM CAPABILITY SMOKE FAILED: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
}
main().catch((e) => {
  console.error("SMOKE ERROR:", String(e?.message || e));
  process.exit(1);
});
