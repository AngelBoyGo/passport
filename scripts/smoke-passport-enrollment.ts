/**
 * Agent enrollment smoke probes: start -> complete -> evidence -> profile read.
 * Run: npm run smoke:agent-enrollment
 */
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  assertEnrollmentSmokeInputs,
  formatEnrollmentSmokeError,
  formatEnrollmentSmokeHelp,
  parseEnrollmentSmokeArgs,
} from "../src/lib/release/enrollment-smoke-args";
import { createEnrollmentSmokePrivateKeyHex } from "../src/lib/release/enrollment-smoke-key";
import { createEnrollmentSmokePayload } from "../src/lib/release/enrollment-smoke-payload";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
} from "../src/lib/enrollment/identity";
import { computePayloadDigest } from "../src/lib/enrollment/evidence-binding";

type ProbeResult = {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  detail?: string;
};

const FETCH_TIMEOUT_MS = 10_000;

let smokeBaseUrl = "http://localhost:3000";

/**
 * Fetches a URL and returns status plus parsed JSON when possible.
 */
async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return { status: response.status, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const parsed = parseEnrollmentSmokeArgs(process.argv);

  if (parsed.showHelp) {
    console.log(formatEnrollmentSmokeHelp());
    process.exit(0);
  }

  const { baseUrl } = assertEnrollmentSmokeInputs(parsed);
  smokeBaseUrl = baseUrl;

  const privateKey = hexToBytes(createEnrollmentSmokePrivateKeyHex());
  const publicKeyHex = bytesToHex(getPublicKey(privateKey));
  const subjectCommitment = deriveAgentCommitment(
    publicKeyHex,
    DEFAULT_ENROLLMENT_CONTEXT
  );

  console.log("=== Passport agent enrollment smoke ===\n");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Subject commitment: ${subjectCommitment.slice(0, 12)}…`);
  console.log(`Public key: ${publicKeyHex.slice(0, 12)}…\n`);

  const results: ProbeResult[] = [];

  const startUrl = `${baseUrl}/api/v1/passport/agents/enroll/start`;
  const startResponse = await fetchJson(startUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ public_key: publicKeyHex }),
  });

  const startBody =
    typeof startResponse.body === "object" && startResponse.body !== null
      ? (startResponse.body as Record<string, unknown>)
      : null;

  const startOk =
    startResponse.status === 200 &&
    startBody?.subject_commitment === subjectCommitment &&
    typeof startBody.challenge_nonce === "string";

  results.push({
    name: "enroll-start",
    url: startUrl,
    status: startResponse.status,
    ok: startOk,
    detail: startOk
      ? undefined
      : `expected 200 with subject_commitment + challenge_nonce, got ${startResponse.status}`,
  });

  if (!startOk || !startBody) {
    printResults(results);
    process.exit(1);
  }

  const nonce = String(startBody.challenge_nonce);
  const completeSignature = bytesToHex(
    await sign(utf8ToBytes(nonce), privateKey)
  );

  const completeUrl = `${baseUrl}/api/v1/passport/agents/enroll/complete`;
  const completeResponse = await fetchJson(completeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      subject_commitment: subjectCommitment,
      signature: completeSignature,
    }),
  });

  const completeBody =
    typeof completeResponse.body === "object" && completeResponse.body !== null
      ? (completeResponse.body as Record<string, unknown>)
      : null;

  const completeOk =
    completeResponse.status === 200 && completeBody?.status === "ISSUED";

  results.push({
    name: "enroll-complete",
    url: completeUrl,
    status: completeResponse.status,
    ok: completeOk,
    detail: completeOk
      ? undefined
      : `expected 200 with status ISSUED, got ${completeResponse.status}`,
  });

  const smokePayload = createEnrollmentSmokePayload();
  const payloadDigest = computePayloadDigest(smokePayload);
  const evidenceSignature = bytesToHex(
    await sign(utf8ToBytes(payloadDigest), privateKey)
  );

  const evidenceUrl = `${baseUrl}/api/v1/passport/agents/${subjectCommitment}/evidence`;
  const evidenceResponse = await fetchJson(evidenceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      source_type: "compliance_report",
      payload: smokePayload,
      signature: evidenceSignature,
    }),
  });

  const evidenceBody =
    typeof evidenceResponse.body === "object" && evidenceResponse.body !== null
      ? (evidenceResponse.body as Record<string, unknown>)
      : null;

  const evidenceOk =
    evidenceResponse.status === 201 &&
    evidenceBody?.enrollment_status === "ENROLLED";

  results.push({
    name: "evidence-ingest",
    url: evidenceUrl,
    status: evidenceResponse.status,
    ok: evidenceOk,
    detail: evidenceOk
      ? undefined
      : `expected 201 with enrollment_status ENROLLED, got ${evidenceResponse.status}`,
  });

  const profileUrl = `${baseUrl}/api/v1/profiles/${subjectCommitment}`;
  const profileResponse = await fetchJson(profileUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const profileBody =
    typeof profileResponse.body === "object" && profileResponse.body !== null
      ? (profileResponse.body as Record<string, unknown>)
      : null;

  const profileOk =
    profileResponse.status === 200 &&
    profileBody?.enrollment_status === "ENROLLED";

  results.push({
    name: "profile-enrolled",
    url: profileUrl,
    status: profileResponse.status,
    ok: profileOk,
    detail: profileOk
      ? undefined
      : `expected 200 with enrollment_status ENROLLED, got ${profileResponse.status}`,
  });

  printResults(results);
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

function printResults(results: ProbeResult[]): void {
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
    console.error("Agent enrollment smoke probes failed.");
  } else {
    console.log("All agent enrollment smoke probes passed.");
    console.log("SMOKE_PASS agent-enrollment");
  }
}

main().catch((error) => {
  console.error(formatEnrollmentSmokeError(error, smokeBaseUrl));
  process.exit(1);
});
