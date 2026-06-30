/**
 * Agent presentation smoke: enroll -> PUT presentation -> GET passport/profile -> optional clear.
 * Run: npm run smoke:presentation
 */
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  assertEnrollmentSmokeInputs,
  formatEnrollmentSmokeError,
  parseEnrollmentSmokeArgs,
} from "../src/lib/release/enrollment-smoke-args";
import { createEnrollmentSmokePrivateKeyHex } from "../src/lib/release/enrollment-smoke-key";
import { createEnrollmentSmokePayload } from "../src/lib/release/enrollment-smoke-payload";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
} from "../src/lib/enrollment/identity";
import { computePayloadDigest } from "../src/lib/enrollment/evidence-binding";
import { computePresentationDigest } from "../src/lib/enrollment/presentation";

type ProbeResult = {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  detail?: string;
};

const FETCH_TIMEOUT_MS = 10_000;
const SMOKE_PHOTO_URL = "https://cdn.example.com/smoke/agent-photo.png";
const SMOKE_PHOTO_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SMOKE_PHOTO_MIME = "image/png";

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

/**
 * Runs enrollment start/complete/evidence so presentation updates are allowed.
 */
async function enrollAgent(
  baseUrl: string,
  privateKey: Uint8Array,
  publicKeyHex: string,
  subjectCommitment: string
): Promise<boolean> {
  const startResponse = await fetchJson(`${baseUrl}/api/v1/passport/agents/enroll/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ public_key: publicKeyHex }),
  });

  const startBody =
    typeof startResponse.body === "object" && startResponse.body !== null
      ? (startResponse.body as Record<string, unknown>)
      : null;

  if (
    startResponse.status !== 200 ||
    !startBody ||
    startBody.subject_commitment !== subjectCommitment ||
    typeof startBody.challenge_nonce !== "string"
  ) {
    return false;
  }

  const completeSignature = bytesToHex(
    await sign(utf8ToBytes(String(startBody.challenge_nonce)), privateKey)
  );

  const completeResponse = await fetchJson(
    `${baseUrl}/api/v1/passport/agents/enroll/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        subject_commitment: subjectCommitment,
        signature: completeSignature,
      }),
    }
  );

  const completeBody =
    typeof completeResponse.body === "object" && completeResponse.body !== null
      ? (completeResponse.body as Record<string, unknown>)
      : null;

  if (completeResponse.status !== 200 || completeBody?.status !== "ISSUED") {
    return false;
  }

  const smokePayload = createEnrollmentSmokePayload();
  const payloadDigest = computePayloadDigest(smokePayload);
  const evidenceSignature = bytesToHex(
    await sign(utf8ToBytes(payloadDigest), privateKey)
  );

  const evidenceResponse = await fetchJson(
    `${baseUrl}/api/v1/passport/agents/${subjectCommitment}/evidence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        source_type: "compliance_report",
        payload: smokePayload,
        signature: evidenceSignature,
      }),
    }
  );

  const evidenceBody =
    typeof evidenceResponse.body === "object" && evidenceResponse.body !== null
      ? (evidenceResponse.body as Record<string, unknown>)
      : null;

  return (
    evidenceResponse.status === 201 && evidenceBody?.enrollment_status === "ENROLLED"
  );
}

async function main(): Promise<void> {
  const parsed = parseEnrollmentSmokeArgs(process.argv);
  if (parsed.showHelp) {
    console.log(
      [
        "Passport agent presentation smoke (enroll -> PUT presentation -> GET passport/profile)",
        "",
        "Usage:",
        "  npm run smoke:presentation",
        "  npm run smoke:presentation -- --base-url http://localhost:3000",
      ].join("\n")
    );
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

  console.log("=== Passport agent presentation smoke ===\n");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Subject commitment: ${subjectCommitment.slice(0, 12)}…\n`);

  const results: ProbeResult[] = [];

  const enrolled = await enrollAgent(
    baseUrl,
    privateKey,
    publicKeyHex,
    subjectCommitment
  );

  results.push({
    name: "enroll-for-presentation",
    url: `${baseUrl}/api/v1/passport/agents/enroll/*`,
    status: enrolled ? 200 : 0,
    ok: enrolled,
    detail: enrolled ? undefined : "enrollment flow did not reach ENROLLED",
  });

  if (!enrolled) {
    printResults(results);
    process.exit(1);
  }

  const presentationDigest = computePresentationDigest({
    subjectCommitment,
    photoUrl: SMOKE_PHOTO_URL,
    photoContentSha256: SMOKE_PHOTO_SHA256,
    photoMimeType: SMOKE_PHOTO_MIME,
  });
  const presentationSignature = bytesToHex(
    await sign(utf8ToBytes(presentationDigest), privateKey)
  );

  const presentationUrl = `${baseUrl}/api/v1/passport/agents/${subjectCommitment}/presentation`;
  const putResponse = await fetchJson(presentationUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      photo_url: SMOKE_PHOTO_URL,
      photo_content_sha256: SMOKE_PHOTO_SHA256,
      photo_mime_type: SMOKE_PHOTO_MIME,
      signature: presentationSignature,
    }),
  });

  const putBody =
    typeof putResponse.body === "object" && putResponse.body !== null
      ? (putResponse.body as Record<string, unknown>)
      : null;
  const putPresentation =
    putBody?.presentation &&
    typeof putBody.presentation === "object" &&
    putBody.presentation !== null
      ? (putBody.presentation as Record<string, unknown>)
      : null;

  const putOk =
    putResponse.status === 200 &&
    putPresentation?.url === SMOKE_PHOTO_URL &&
    putPresentation?.content_sha256 === SMOKE_PHOTO_SHA256 &&
    putPresentation?.mime_type === SMOKE_PHOTO_MIME;

  results.push({
    name: "presentation-put",
    url: presentationUrl,
    status: putResponse.status,
    ok: putOk,
    detail: putOk
      ? undefined
      : `expected 200 with presentation block, got ${putResponse.status}`,
  });

  const passportUrl = `${baseUrl}/api/v1/passport/agents/${subjectCommitment}/passport`;
  const passportResponse = await fetchJson(passportUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const passportBody =
    typeof passportResponse.body === "object" && passportResponse.body !== null
      ? (passportResponse.body as Record<string, unknown>)
      : null;
  const passportPresentation =
    passportBody?.presentation &&
    typeof passportBody.presentation === "object" &&
    passportBody.presentation !== null
      ? (passportBody.presentation as Record<string, unknown>)
      : null;

  const passportOk =
    passportResponse.status === 200 &&
    passportPresentation?.url === SMOKE_PHOTO_URL;

  results.push({
    name: "passport-presentation",
    url: passportUrl,
    status: passportResponse.status,
    ok: passportOk,
    detail: passportOk
      ? undefined
      : `expected 200 with presentation.url, got ${passportResponse.status}`,
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
  const profilePresentation =
    profileBody?.presentation &&
    typeof profileBody.presentation === "object" &&
    profileBody.presentation !== null
      ? (profileBody.presentation as Record<string, unknown>)
      : null;

  const profileOk =
    profileResponse.status === 200 &&
    profilePresentation?.url === SMOKE_PHOTO_URL;

  results.push({
    name: "profile-presentation",
    url: profileUrl,
    status: profileResponse.status,
    ok: profileOk,
    detail: profileOk
      ? undefined
      : `expected 200 with presentation.url, got ${profileResponse.status}`,
  });

  const clearDigest = computePresentationDigest({
    subjectCommitment,
    photoUrl: "",
    photoContentSha256: "",
    photoMimeType: "",
  });
  const clearSignature = bytesToHex(
    await sign(utf8ToBytes(clearDigest), privateKey)
  );

  const clearResponse = await fetchJson(presentationUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      photo_url: "",
      photo_content_sha256: "",
      photo_mime_type: "",
      signature: clearSignature,
    }),
  });

  const clearBody =
    typeof clearResponse.body === "object" && clearResponse.body !== null
      ? (clearResponse.body as Record<string, unknown>)
      : null;

  const clearOk =
    clearResponse.status === 200 && clearBody?.presentation === null;

  results.push({
    name: "presentation-clear",
    url: presentationUrl,
    status: clearResponse.status,
    ok: clearOk,
    detail: clearOk
      ? undefined
      : `expected 200 with presentation null, got ${clearResponse.status}`,
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
    console.error("Agent presentation smoke probes failed.");
  } else {
    console.log("All agent presentation smoke probes passed.");
    console.log("SMOKE_PASS presentation");
  }
}

main().catch((error) => {
  console.error(formatEnrollmentSmokeError(error, smokeBaseUrl));
  process.exit(1);
});
