/**
 * AngelCoin smoke probes: authenticated grant + passport-live read verification.
 * Run: npm run smoke:angelcoin
 */
import {
  assertAngelcoinSmokeInputs,
  formatAngelcoinSmokeHelp,
  parseAngelcoinSmokeArgs,
} from "../src/lib/release/angelcoin-smoke-args";

type ProbeResult = {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  detail?: string;
};

/**
 * Fetches a URL and returns status plus parsed JSON when possible.
 */
async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { status: response.status, body, text };
}

/**
 * Probes POST /api/v1/passport/credits/grants with Bearer auth.
 */
async function probeGrant(
  baseUrl: string,
  apiKey: string,
  subjectCommitment: string
): Promise<ProbeResult> {
  const url = `${baseUrl}/api/v1/passport/credits/grants`;
  const { status, body } = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      subject_commitment: subjectCommitment,
      amount: 1,
    }),
  });

  const ok =
    status === 201 &&
    typeof body === "object" &&
    body !== null &&
    (body as { subject_commitment?: string }).subject_commitment ===
      subjectCommitment;

  return {
    name: "grant",
    url,
    status,
    ok,
    detail: ok ? undefined : `expected 201 grant for ${subjectCommitment.slice(0, 12)}…, got ${status}`,
  };
}

/**
 * Probes GET /api/v1/passport/agents/:id/passport-live and validates live shape.
 */
async function probePassportLive(
  baseUrl: string,
  subjectCommitment: string
): Promise<ProbeResult> {
  const url = `${baseUrl}/api/v1/passport/agents/${subjectCommitment}/passport-live`;
  const { status, body } = await fetchJson(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;

  const hasShape =
    record !== null &&
    typeof record.accessTier === "string" &&
    "storedAccessTier" in record &&
    typeof record.availableBalance === "number" &&
    record.subjectCommitment === subjectCommitment;

  const ok = status === 200 && hasShape;

  return {
    name: "passport-live",
    url,
    status,
    ok,
    detail: ok
      ? undefined
      : `expected 200 with accessTier/storedAccessTier/availableBalance, got ${status}`,
  };
}

async function main(): Promise<void> {
  const parsed = parseAngelcoinSmokeArgs(process.argv);

  if (parsed.showHelp) {
    console.log(formatAngelcoinSmokeHelp());
    process.exit(0);
  }

  const { baseUrl, apiKey, subjectCommitment } =
    assertAngelcoinSmokeInputs(parsed);

  console.log("=== Passport AngelCoin smoke ===\n");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Subject commitment: ${subjectCommitment.slice(0, 12)}…`);
  console.log("API key: [redacted]\n");

  const results: ProbeResult[] = [];
  results.push(await probeGrant(baseUrl, apiKey, subjectCommitment));
  results.push(await probePassportLive(baseUrl, subjectCommitment));

  let failed = false;
  for (const result of results) {
    const statusLabel = result.ok ? "PASS" : "FAIL";
    console.log(
      `[${statusLabel}] ${result.name} ${result.status} ${result.url}${
        result.detail ? ` — ${result.detail}` : ""
      }`
    );
    if (!result.ok) failed = true;
  }

  console.log("");
  if (failed) {
    console.error("AngelCoin smoke probes failed.");
    process.exit(1);
  }

  console.log("All AngelCoin smoke probes passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(
    "AngelCoin smoke script error:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
