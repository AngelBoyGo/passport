/**
 * Read-only smoke probes for Passport + GitHub public portal endpoints.
 * Run: npm run smoke:github
 */
import {
  buildSmokeWarnings,
  formatSmokeHelp,
  parseSmokeArgs,
} from "../src/lib/release/smoke-args";

const RAW_LEAKAGE_PATTERNS = [
  /github\.com\/[^/]+\/[^/\s"']+/i,
  /refs\/heads\//,
  /https?:\/\/[^\s"']+\/[^\s"']+/,
];

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
  url: string
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
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
 * Returns true when response text matches known raw-leakage patterns.
 */
function hasRawLeakage(text: string): string | null {
  for (const pattern of RAW_LEAKAGE_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.source;
    }
  }
  return null;
}

/**
 * Probes GET /api/health and asserts 200 with status ok.
 */
async function probeHealth(baseUrl: string): Promise<ProbeResult> {
  const url = `${baseUrl}/api/health`;
  const { status, body } = await fetchJson(url);
  const ok =
    status === 200 &&
    typeof body === "object" &&
    body !== null &&
    (body as { status?: string }).status === "ok";
  return {
    name: "health",
    url,
    status,
    ok,
    detail: ok ? undefined : `expected 200 { status: "ok" }, got ${status}`,
  };
}

/**
 * Probes GET /api/v1/leaderboard and asserts 200 with leaderboard array.
 */
async function probeLeaderboard(baseUrl: string): Promise<ProbeResult> {
  const url = `${baseUrl}/api/v1/leaderboard`;
  const { status, body, text } = await fetchJson(url);
  const leaderboard =
    typeof body === "object" && body !== null
      ? (body as { leaderboard?: unknown }).leaderboard
      : undefined;
  const leakage = hasRawLeakage(text);
  const ok =
    status === 200 && Array.isArray(leaderboard) && leakage === null;
  return {
    name: "leaderboard",
    url,
    status,
    ok,
    detail: leakage
      ? `raw leakage detected (${leakage})`
      : ok
        ? undefined
        : `expected 200 { leaderboard: [] }, got ${status}`,
  };
}

/**
 * Probes GET /api/v1/profiles/:hash — accepts 200 masked shape or 404.
 */
async function probeProfile(
  baseUrl: string,
  agentHash: string
): Promise<ProbeResult> {
  const url = `${baseUrl}/api/v1/profiles/${agentHash}`;
  const { status, body, text } = await fetchJson(url);

  if (status === 404) {
    return { name: "profile", url, status, ok: true, detail: "not found (404)" };
  }

  if (status >= 500) {
    return {
      name: "profile",
      url,
      status,
      ok: false,
      detail: `server error ${status}`,
    };
  }

  const leakage = hasRawLeakage(text);
  const hasHashField =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { agent_commitment_hash?: unknown }).agent_commitment_hash ===
      "string";

  const ok = status === 200 && hasHashField && leakage === null;
  return {
    name: "profile",
    url,
    status,
    ok,
    detail: leakage
      ? `raw leakage detected (${leakage})`
      : ok
        ? undefined
        : `expected 200 masked profile or 404, got ${status}`,
  };
}

/**
 * Probes GET /api/v1/receipts/:id/public-manifest — accepts 200 masked shape or 404.
 */
async function probeManifest(
  baseUrl: string,
  receiptId: string
): Promise<ProbeResult> {
  const url = `${baseUrl}/api/v1/receipts/${receiptId}/public-manifest`;
  const { status, body, text } = await fetchJson(url);

  if (status === 404) {
    return { name: "manifest", url, status, ok: true, detail: "not found (404)" };
  }

  if (status >= 500) {
    return {
      name: "manifest",
      url,
      status,
      ok: false,
      detail: `server error ${status}`,
    };
  }

  const leakage = hasRawLeakage(text);
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  const hasMaskedFields = Array.isArray(record?.masked_fields);
  const hasEnforcementKeys =
    record !== null &&
    "enforcement_state" in record &&
    "linked_liability_event_id" in record;

  const ok =
    status === 200 && hasMaskedFields && hasEnforcementKeys && leakage === null;

  return {
    name: "manifest",
    url,
    status,
    ok,
    detail: leakage
      ? `raw leakage detected (${leakage})`
      : ok
        ? undefined
        : `expected masked manifest or 404, got ${status}`,
  };
}

async function main(): Promise<void> {
  const { baseUrl, agentHash, receiptId, showHelp } = parseSmokeArgs(process.argv);

  if (showHelp) {
    console.log(formatSmokeHelp());
    process.exit(0);
  }

  console.log("=== Passport GitHub smoke (read-only) ===\n");
  console.log(`Base URL: ${baseUrl}`);
  console.log(
    "Note: BASE_URL should target the deployed/staging app for rollout verification."
  );
  if (agentHash) console.log(`Agent hash: ${agentHash.slice(0, 12)}…`);
  if (receiptId) console.log(`Receipt ID: ${receiptId}`);

  if (!agentHash) {
    console.log("Agent profile probe: skipped (AGENT_HASH/--agent-hash omitted)");
  }
  if (!receiptId) {
    console.log("Receipt manifest probe: skipped (RECEIPT_ID/--receipt-id omitted)");
  }

  const warnings = buildSmokeWarnings({ baseUrl });
  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("");

  const results: ProbeResult[] = [];

  results.push(await probeHealth(baseUrl));
  results.push(await probeLeaderboard(baseUrl));

  if (agentHash) {
    results.push(await probeProfile(baseUrl, agentHash));
  }

  if (receiptId) {
    results.push(await probeManifest(baseUrl, receiptId));
  }

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
    console.error("Smoke probes failed.");
    process.exit(1);
  }

  console.log("All smoke probes passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Smoke script error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
