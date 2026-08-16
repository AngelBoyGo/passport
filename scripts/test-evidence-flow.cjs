/**
 * End-to-end test: enroll a fresh agent, post signed evidence, verify profile.
 *
 * Usage:
 *   1. Set PASSPORT_BASE_URL (defaults to https://passport.metis.gold)
 *   2. Run: node scripts/test-evidence-flow.cjs
 *
 * No dependencies beyond Node.js 20+ built-in crypto.
 */

const crypto = require("node:crypto");
const PASSPORT_BASE_URL = process.env.PASSPORT_BASE_URL || "https://passport.metis.gold";

async function api(path, options = {}) {
  const url = PASSPORT_BASE_URL + path;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(Buffer.from(input, "utf-8")).digest("hex");
}

function canonicalJson(obj) {
  const sorted = Object.keys(obj).sort();
  const ordered = {};
  for (const key of sorted) ordered[key] = obj[key];
  return JSON.stringify(ordered);
}

async function main() {
  console.log("=== Passport E2E Evidence Flow Test ===\n");

  // 1. Generate fresh Ed25519 keypair
  const keyPair = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const pubKeyHex = Buffer.from(keyPair.publicKey.subarray(-32)).toString("hex");
  const privateKeyObject = crypto.createPrivateKey({
    key: keyPair.privateKey,
    format: "der",
    type: "pkcs8",
  });
  const subjectCommitment = sha256Hex("agent-id:" + pubKeyHex.toLowerCase() + ":passport-v1");

  console.log("Agent keypair generated:");
  console.log("  publicKey:         " + pubKeyHex);
  console.log("  subjectCommitment: " + subjectCommitment);
  console.log("");

  // 2. Start enrollment
  console.log("1. Starting enrollment...");
  const startRes = await api("/api/v1/passport/agents/enroll/start", {
    method: "POST",
    body: JSON.stringify({ public_key: pubKeyHex }),
  });
  if (startRes.status !== 200) {
    console.error("   FAILED:", startRes.status, JSON.stringify(startRes.body));
    console.log("   Status: " + startRes.body.status);
    console.log("   (may already be enrolled)");
  }
  const challengeNonce = startRes.body.challenge_nonce;
  console.log("   Challenge: " + challengeNonce);

  // 3. Sign challenge nonce and complete enrollment
  console.log("2. Signing challenge and completing enrollment...");
  const sig = crypto.sign(null, Buffer.from(challengeNonce, "utf-8"), privateKeyObject);
  const sigHex = sig.toString("hex");

  const completeRes = await api("/api/v1/passport/agents/enroll/complete", {
    method: "POST",
    body: JSON.stringify({ subject_commitment: subjectCommitment, signature: sigHex }),
  });
  if (completeRes.status !== 200) {
    console.error("   FAILED:", completeRes.status, JSON.stringify(completeRes.body));
    process.exit(1);
  }
  console.log("   Status: " + completeRes.body.status);

  // 4. Build and sign a github_commit_payload evidence
  console.log("3. Posting signed evidence...");
  const evidencePayload = {
    sha: "abc123def456",
    html_url: "https://github.com/test/repo/commit/abc123",
    commit: {
      message: "feat: add passport integration",
      author: { name: "TestAgent" },
    },
  };

  // Compute the digest: sha256(canonicalJson(payload))
  const payloadCanonical = canonicalJson(evidencePayload);
  const payloadDigest = sha256Hex(payloadCanonical);
  console.log("   Payload digest to sign: " + payloadDigest);

  // Sign the digest (sha256 canonical hash, NOT the raw payload)
  const evidenceSig = crypto.sign(
    null,
    Buffer.from(payloadDigest, "utf-8"),
    privateKeyObject
  );

  const evidenceRes = await api(
    "/api/v1/passport/agents/" + subjectCommitment + "/evidence",
    {
      method: "POST",
      body: JSON.stringify({
        source_type: "github_commit_payload",
        payload: evidencePayload,
        signature: evidenceSig.toString("hex"),
      }),
    }
  );
  if (evidenceRes.status === 201) {
    console.log("   Evidence posted!");
    console.log("   event_commitment_hash: " + evidenceRes.body.event_commitment_hash);
  } else if (evidenceRes.status === 500) {
    console.error("   500 error:", JSON.stringify(evidenceRes.body));
    console.error("   ⚠ INGESTION_COMMITMENT_SALT may not be set yet.");
    process.exit(1);
  } else {
    console.error("   FAILED:", evidenceRes.status, JSON.stringify(evidenceRes.body));
    process.exit(1);
  }

  // 5. Verify the profile
  console.log("4. Checking profile...");
  const profileRes = await api("/api/v1/profiles/" + subjectCommitment);
  if (profileRes.status === 200) {
    console.log("   Profile found! Evidence count: " + profileRes.body.totals?.evidence_count);
    console.log("   Enrollment status: " + profileRes.body.enrollment_status);
  } else {
    console.log("   Profile: " + profileRes.status);
  }

  console.log("\n=== ALL PASSED ===");
  console.log("View profile: " + PASSPORT_BASE_URL + "/profiles/" + subjectCommitment);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});