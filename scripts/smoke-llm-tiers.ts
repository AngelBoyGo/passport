// scripts/smoke-llm-tiers.ts — live probe: both tiers must complete on the real gateway.
import "dotenv/config";
import { completeTier } from "../src/lib/llm/gateway-client";

async function main() {
  for (const tier of ["neuron", "money"] as const) {
    const t0 = Date.now();
    const out = await completeTier(tier, {
      system: "You are a smoke test. Reply with strict JSON only.",
      user: 'Return {"ok":true,"tier":"<arg.tier>"} exactly.',
      json: true,
      temperature: 0,
    });
    console.log(`[${tier}] ${Date.now() - t0}ms -> ${out.slice(0, 120)}`);
  }
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", String(e?.message || e));
  process.exit(1);
});
