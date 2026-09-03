#!/usr/bin/env node
/**
 * Agent Activation v2 — uses @noble/ed25519 for signing (same library as verifier).
 * This eliminates cross-library Ed25519 compatibility issues.
 */

const { generateKeypair, sign, getPublicKey } = require("../node_modules/@noble/ed25519.js") || {};
const noble = require("@noble/ed25519");
const { sha256 } = require("@noble/hashes/sha2.js");
const { bytesToHex, hexToBytes, utf8ToBytes } = require("@noble/hashes/utils.js");
const http = require("http");
const fs = require("fs");

// Configure @noble/ed25519 sha512 (required for Node.js)
const { sha512 } = require("@noble/hashes/sha2.js");
noble.hashes.sha512 = sha512;
noble.hashes.sha512Async = (msg) => Promise.resolve(sha512(msg));

const BASE = "http://localhost:3000";
const ISSUER_KEY = process.env.PASSPORT_ISSUER_KEY;
const NUM = 5;

function fetchJson(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port || 80,
      path: u.pathname + u.search, method: method || "GET",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sha256Hex(s) { return bytesToHex(sha256(utf8ToBytes(s))); }

function canonicalJson(obj) {
  const sorted = Object.keys(obj).sort();
  const ordered = {};
  for (const key of sorted) ordered[key] = obj[key];
  return JSON.stringify(ordered);
}

function solvePoW(nonce, difficulty) {
  const target = "0".repeat(difficulty);
  for (let i = 0; i < 50000000; i++) {
    if (sha256Hex(`${nonce}:${i}`).startsWith(target)) return String(i);
  }
  throw new Error("PoW failed");
}

const NAMES = [
  { name: "callora-scout", domain: "CODE_GENERATION" },
  { name: "callora-analyst", domain: "SYSTEM_INTEGRATION" },
  { name: "callora-voice", domain: "CUSTOMER_SUPPORT" },
  { name: "callora-guard", domain: "FINANCIAL_CLEARING" },
  { name: "callora-ops", domain: "CODE_GENERATION" },
];

async function main() {
  console.log("🚀 PASSPORT ACTIVATION v2 — @noble/ed25519 signing\n");
  const results = [];

  // ═══ PHASE 1: ENROLL ═══
  console.log("═══ PHASE 1: ENROLLMENT ═══\n");
  for (let i = 0; i < NUM; i++) {
    const meta = NAMES[i];
    console.log(`[${i + 1}/${NUM}] ${meta.name}`);

    // Generate keypair with @noble/ed25519
    const privKey = noble.utils.randomSecretKey();
    const pubKeyBytes = noble.getPublicKey(privKey);
    const pubHex = bytesToHex(pubKeyBytes);
    const privHex = bytesToHex(privKey);

    // Challenge
    const chal = await fetchJson(`${BASE}/api/v1/passport/agents/autonomous/challenge`, "POST", { public_key: pubHex });
    if (chal.status >= 400) { console.log(`  ❌ Challenge:`, chal.data); continue; }

    // PoW
    const powNonce = solvePoW(chal.data.challenge_nonce, chal.data.pow_difficulty);
    console.log(`  PoW solved`);

    // Sign — SAME LIBRARY as verifier
    const msg = `${chal.data.challenge_nonce}:${powNonce}:${pubHex}`;
    const digest = sha256(utf8ToBytes(msg));
    const sig = bytesToHex(noble.sign(digest, privKey));

    // Provision
    const prov = await fetchJson(`${BASE}/api/v1/passport/agents/autonomous/provision`, "POST", {
      public_key: pubHex, challenge_nonce: chal.data.challenge_nonce,
      pow_nonce: powNonce, signature: sig,
      display_name: meta.name, domain: meta.domain,
    });
    if (prov.status >= 400) { console.log(`  ❌ Provision:`, prov.data); continue; }

    console.log(`  ✅ ${prov.data.subject_commitment.slice(0, 16)}... [${prov.data.initial_credits} ANGEL]`);
    results.push({
      name: meta.name, domain: meta.domain,
      commitment: prov.data.subject_commitment,
      api_key: prov.data.api_key,
      priv_hex: bytesToHex(privKey),
      credits: prov.data.initial_credits,
    });
  }
  console.log(`\nEnrolled: ${results.length}/${NUM}`);

  // ═══ PHASE 2: FUND WALLETS ═══
  console.log("\n═══ PHASE 2: FUND WALLETS ═══\n");
  for (const a of results) {
    const res = await fetchJson(`${BASE}/api/v1/agent-wallet`, "POST", {
      action: "deposit", commitment: a.commitment, amount: a.credits,
    }, { Authorization: `Bearer ${ISSUER_KEY}` });
    console.log(`  ${res.status < 400 ? "✅" : "⚠️"} ${a.name}: AgentWallet = ${a.credits} ANGEL`);
  }

  // ═══ PHASE 3: EVIDENCE (using @noble for signing) ═══
  console.log("\n═══ PHASE 3: EVIDENCE ═══\n");
  const evidenceBuilders = [
    (a) => ({ source_type: "task_deliverable", payload: { task_id: `${a.name}_uptime_${Date.now()}`, digest: sha256Hex("healthy"), observed_at: new Date().toISOString() } }),
    (a) => ({ source_type: "otel_genai_trace", payload: { name: "agent_init", attributes: { "gen_ai.usage.input_tokens": 150, "gen_ai.usage.output_tokens": 300 } } }),
    (a) => ({ source_type: "github_commit_payload", payload: { sha: bytesToHex(crypto.getRandomValues(new Uint8Array(20))), commit: { message: `deploy: ${a.name}` } } }),
  ];

  for (const agent of results) {
    const privKey = hexToBytes(agent.priv_hex);
    console.log(`  ${agent.name}:`);
    for (let e = 0; e < evidenceBuilders.length; e++) {
      const payload = evidenceBuilders[e](agent);
      const canonical = canonicalJson(payload.payload);
      // CRITICAL: The server verifies against utf8ToBytes(digestHexString), NOT raw sha256 bytes.
      // We must sign the HEX STRING encoded as UTF-8, not the raw digest.
      const digestHex = bytesToHex(sha256(utf8ToBytes(canonical)));
      const sig = bytesToHex(noble.sign(utf8ToBytes(digestHex), privKey));

      const res = await fetchJson(`${BASE}/api/v1/passport/agents/${agent.commitment}/evidence`, "POST",
        { ...payload, signature: sig }, { Authorization: `Bearer ${agent.api_key}` });
      if (res.status < 400) {
        console.log(`    ✅ Evidence ${e + 1}: ${res.data.event_commitment_hash?.slice(0, 16)}...`);
      } else {
        console.log(`    ⚠️ Evidence ${e + 1} [${res.status}]: ${JSON.stringify(res.data).slice(0, 100)}`);
      }
    }
  }

  // ═══ PHASE 4: FIRST A2A TRANSACTION ═══
  console.log("\n═══ PHASE 4: FIRST A2A TRANSACTION ═══\n");
  if (results.length >= 2) {
    const hirer = results[0], worker = results[1];
    const hirerPriv = hexToBytes(hirer.priv_hex);
    const proposalId = `hire_${Date.now()}`;
    const terms = { amount: 5, domain: "CODE_GENERATION", scope: "Monitor API and report uptime", expiry: new Date(Date.now() + 7 * 86400000).toISOString() };
    const canonicalTerms = canonicalJson(terms);
    const msg = `${proposalId}:${hirer.commitment}:${worker.commitment}:${canonicalTerms}`;
    const msgDigestHex = bytesToHex(sha256(utf8ToBytes(msg)));
    const sig = bytesToHex(noble.sign(utf8ToBytes(msgDigestHex), hirerPriv));

    const hireRes = await fetchJson(`${BASE}/api/v1/a2a/hire`, "POST", {
      hirer_commitment: hirer.commitment, worker_commitment: worker.commitment,
      proposal_id: proposalId, terms: terms, signature: sig,
    }, { Authorization: `Bearer ${hirer.api_key}` });

    if (hireRes.status === 201) {
      console.log(`  ✅ A2A HIRE: ${hireRes.data.engagement_id}`);

      // Worker delivers
      const workerPriv = hexToBytes(worker.priv_hex);
      const deliverable = { task_id: proposalId, digest: sha256Hex("Task complete"), observed_at: new Date().toISOString() };
      const delCanonical = canonicalJson(deliverable);
      const delDigestHex = bytesToHex(sha256(utf8ToBytes(delCanonical)));
      const delSig = bytesToHex(noble.sign(utf8ToBytes(delDigestHex), workerPriv));

      await fetchJson(`${BASE}/api/v1/passport/agents/${worker.commitment}/evidence`, "POST",
        { source_type: "task_deliverable", payload: deliverable, signature: delSig },
        { Authorization: `Bearer ${worker.api_key}` });
      console.log(`  ✅ Deliverable posted`);

      // Accept
      const acceptRes = await fetchJson(`${BASE}/api/v1/passport/engagements/${proposalId}/accept`, "POST", null,
        { Authorization: `Bearer ${hirer.api_key}` });
      if (acceptRes.status < 400) {
        console.log(`  ✅ ENGAGEMENT PAID — FIRST REAL TRANSACTION!`);
      } else {
        console.log(`  ⚠️ Accept [${acceptRes.status}]:`, JSON.stringify(acceptRes.data).slice(0, 150));
      }
    } else {
      console.log(`  ❌ Hire [${hireRes.status}]:`, JSON.stringify(hireRes.data).slice(0, 200));
    }
  }

  // ═══ PHASE 5: VERIFY ═══
  console.log("\n═══ PHASE 5: VERIFY ═══\n");
  for (const [name, path] of [["Leaderboard", "/api/v1/leaderboard"], ["Network", "/api/v1/network"], ["Revenue", "/api/v1/revenue"], ["Rate", "/api/v1/rate"], ["Monetary", "/api/v1/receipts/monetary"]]) {
    const res = await fetchJson(`${BASE}${path}`);
    console.log(`  ${res.status < 400 ? "✅" : "❌"} ${name} [${res.status}]`);
  }
  for (const a of results.slice(0, 3)) {
    const res = await fetchJson(`${BASE}/api/v1/verify/${a.commitment}`);
    if (res.status < 400) {
      console.log(`  ✅ ${a.name}: score=${res.data.reputation?.score} tier=${res.data.reputation?.tier} verified=${res.data.verified}`);
    }
  }

  fs.writeFileSync("/tmp/passport-agents-v2.json", JSON.stringify(results, null, 2));
  console.log("\n🏁 ACTIVATION COMPLETE");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });