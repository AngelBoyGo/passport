// One-off diagnostic: POST /chat/completions variants against the gateway.
import "dotenv/config";

const base = process.env.LLM_BASE_URL!.replace(/\/+$/, "");
const key = process.env.LLM_API_KEY!;

async function probe(model: string, jsonMode: boolean) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Smoke test." },
        { role: "user", content: 'Reply {"ok":true}' },
      ],
      temperature: 0,
      max_tokens: 20,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  console.log(`${model} json=${jsonMode} -> ${res.status}`);
  if (!res.ok) {
    const t = await res.text();
    console.log(`   body: ${t.slice(0, 140).replace(/\s+/g, " ")}`);
  } else {
    const d = await res.json();
    console.log(`   -> ${d.choices?.[0]?.message?.content?.slice(0, 80)}`);
  }
}

async function main() {
  await probe("deepseek-v4-flash", false);
  await probe("deepseek-v4-pro", false);
  await probe("gpt-4o-mini", false);
  await probe("deepseek-v4-flash", true);
  process.exit(0);
}

main();
