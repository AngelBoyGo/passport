// scripts/probe-deepseek-upstream.ts — isolate WHERE the deepseek 502 comes from.
import "dotenv/config";

const base = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
const key = process.env.LLM_API_KEY || "";

async function probe(model: string) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "say ok" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const ct = res.headers.get("content-type") || "";
    let body = "";
    if (!res.ok) body = (await res.text()).replace(/\s+/g, " ").slice(0, 90);
    console.log(`${String(res.status).padEnd(4)} ${String(Date.now() - t0).padStart(6)}ms  ${model}  ${ct.split(";")[0]}  ${body}`);
  } catch (e) {
    console.log(`ERR  ${model}: ${String((e as Error)?.message || e).slice(0, 80)}`);
  }
}

async function main() {
  console.log(`base=${base}`);
  const models = [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek/deepseek-chat",
    "deepseek-ai/DeepSeek-V3",
    "DeepSeek-V3-0324",
    "accounts/fireworks/models/deepseek-v3",
    "gpt-4o-mini",
  ];
  for (const m of models) await probe(m);
  process.exit(0);
}
main();
