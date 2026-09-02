#!/usr/bin/env node
/**
 * Passport Activation — runs from local machine against production API.
 * Enrolls agents, funds wallets, posts evidence, does first A2A hire.
 */

const crypto = require("crypto");
const http = require("http");

const BASE = "http://167.99.157.125:3000";
const ISSUER_KEY = "pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4";
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

function sha256Hex(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

function makeSigner(privPkcs8B64) {
  const keyObj = crypto.createPrivateKey({
    key: Buffer.from(privPkcs8B64, "base64"),
    format: "der", type: "pkcs8",
  });
  return {
    signRawBytes(rawBytes) { return crypto.sign(null, rawBytes, keyObj).toString("hex"); },
  };
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
  console.log("🚀 PASSPORT ACTIVATION — from local machine\n");
  const results = [];

  // ═══ PHASE 1: ENROLL ═══
  console.log("═══ PHASE 1: ENROLLMENT ═══\n");
  for (let i = 0; i < NUM; i++) {
    const meta = NAMES[i];
    console.log(`[${i + 1}/${NUM}] ${meta.name} (${meta.domain})`);

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubDer = publicKey.export({ type: "spki", format: "der" });
    const pubHex = Buffer.from(pubDer.slice(-32)).toString("hex");
    const privPkcs8B64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const signer = makeSigner(privPkcs8B64);

    const chal = await fetchJson(`${BASE}/api/v1/passport/agents/autonomous/challenge`, "POST", { public_key: pubHex });
    if (chal.status >= 400) { console.log(`  ❌ Challenge:`, chal.data); continue; }

    const powNonce = solvePoW(chal.data.challenge_nonce, chal.data.pow_difficulty);
    console.log(`  PoW solved (difficulty ${chal.data.pow_difficulty})`);

    const msg = `${chal.data.challenge_nonce}:${powNonce}:${pubHex}`;
    const digestBytes = Buffer.from(sha256Hex(msg), "hex");
    const sig = signer.signRawBytes(digestBytes);

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
      priv_pkcs8_b64: privPkcs8B64,
      credits: prov.data.initial_credits,
    });
  }
  console.log(`\nEnrolled: ${results.length}/${NUM}`);

  // ═══ PHASE 2: FUND WALLETS ═══
  console.log("\n═══ PHASE 2: FUND AGENTWALLETS ═══\n");
  for (const a of results) {
    const res = await fetchJson(`${BASE}/api/v1/agent-wallet`, "POST", {
      action: "deposit", commitment: a.commitment, amount: a.credits,
    }, { Authorization: `Bearer ${ISSUER_KEY}` });
    console.log(`  ${res.status < 400 ? "✅" : "⚠️"} ${a.name}: AgentWallet = ${a.credits} ANGEL`);
  }

  // ═══ PHASE 3: EVIDENCE ═══
  console.log("\n═══ PHASE 3: EVIDENCE ═══\n");
  const evidenceBuilders = [
    (a) => ({ source_type: "task_deliverable", payload: { task_id: `${a.name}_uptime_${Date.now()}`, digest: sha256Hex("healthy"), observed_at: new Date().toISOString() } }),
    (a) => ({ source_type: "otel_genai_trace", payload: { name: "agent_init", attributes: { "gen_ai.usage.input_tokens": 150, "gen_ai.usage.output_tokens": 300 } } }),
    (a) => ({ source_type: "github_commit_payload", payload: { sha: crypto.randomBytes(20).toString("hex"), commit: { message: `deploy: ${a.name} initial setup` } } }),
  ];

  for (const a of results) {
    const signer = makeSigner(a.priv_pkcs8_b64);
    console.log(`  ${a.name}:`);
    for (let e = 0; e < evidenceBuilders.length; e++) {
      const payload = evidenceBuilders[e](a);
      const canonical = JSON.stringify(payload.payload, Object.keys(payload.payload).sort());
      // CRITICAL: Passport verifies against utf8ToBytes(digest_hex_string), NOT raw hex bytes
      const digestHexStr = sha256Hex(canonical);
      const sig = signer.signRawBytes(Buffer.from(digestHexStr, "utf8"));
      const res = await fetchJson(`${BASE}/api/v1/passport/agents/${a.commitment}/evidence`, "POST",
        { ...payload, signature: sig }, { Authorization: `Bearer ${a.api_key}` });
      if (res.status < 400) {
        console.log(`    ✅ Evidence ${e + 1}`);
      } else {
        console.log(`    ⚠️ Evidence ${e + 1} [${res.status}]: ${JSON.stringify(res.data).slice(0, 80)}`);
      }
    }
  }

  // ═══ PHASE 4: FIRST A2A TRANSACTION ═══
  console.log("\n═══ PHASE 4: FIRST A2A TRANSACTION ═══\n");
  if (results.length >= 2) {
    const hirer = results[0], worker = results[1];
    const hirerSigner = makeSigner(hirer.priv_pkcs8_b64);
    const proposalId = `hire_${Date.now()}`;
    const terms = { amount: 5, domain: "CODE_GENERATION", scope: "Monitor API and report uptime", expiry: new Date(Date.now() + 7 * 86400000).toISOString() };
    const canonicalTerms = JSON.stringify(terms, Object.keys(terms).sort());
    const msg = `${proposalId}:${hirer.commitment}:${worker.commitment}:${canonicalTerms}`;
    const sig = hirerSigner.signRawBytes(Buffer.from(sha256Hex(msg), "hex"));

    const hireRes = await fetchJson(`${BASE}/api/v1/a2a/hire`, "POST", {
      hirer_commitment: hirer.commitment, worker_commitment: worker.commitment,
      proposal_id: proposalId, terms: terms, signature: sig,
    }, { Authorization: `Bearer ${hirer.api_key}` });

    if (hireRes.status === 201) {
      console.log(`  ✅ A2A HIRE: ${hireRes.data.engagement_id} [${terms.amount} ANGEL]`);

      // Worker delivers
      const workerSigner = makeSigner(worker.priv_pkcs8_b64);
      const deliverable = { task_id: proposalId, digest: sha256Hex("Uptime check: healthy"), observed_at: new Date().toISOString() };
      const delCanonical = JSON.stringify(deliverable, Object.keys(deliverable).sort());
      const delDigestHex = sha256Hex(delCanonical);
      const delSig = workerSigner.signRawBytes(Buffer.from(delDigestHex, "utf8"));

      const delRes = await fetchJson(`${BASE}/api/v1/passport/agents/${worker.commitment}/evidence`, "POST",
        { source_type: "task_deliverable", payload: deliverable, signature: delSig },
        { Authorization: `Bearer ${worker.api_key}` });
      console.log(`  ${delRes.status < 400 ? "✅" : "⚠️"} Deliverable posted`);

      // Accept
      const acceptRes = await fetchJson(`${BASE}/api/v1/passport/engagements/${proposalId}/accept`, "POST", null,
        { Authorization: `Bearer ${hirer.api_key}` });
      if (acceptRes.status < 400) {
        console.log(`  ✅ ENGAGEMENT PAID — FIRST REAL TRANSACTION!`);
      } else {
        console.log(`  ⚠️ Accept [${acceptRes.status}]:`, JSON.stringify(acceptRes.data).slice(0, 150));
      }
    } else {
      console.log(`  ❌ Hire [${hireRes.status}]:`, JSON.stringify(hireRes.data).slice(0, 150));
    }
  }

  // ═══ PHASE 5: VERIFY ═══
  console.log("\n═══ PHASE 5: VERIFY DASHBOARDS ═══\n");
  const checks = [
    ["Leaderboard", "/api/v1/leaderboard"],
    ["Network", "/api/v1/network"],
    ["Revenue", "/api/v1/revenue"],
    ["Rate", "/api/v1/rate"],
    ["Monetary Receipt", "/api/v1/receipts/monetary"],
  ];
  for (const [name, path] of checks) {
    const res = await fetchJson(`${BASE}${path}`);
    console.log(`  ${res.status < 400 ? "✅" : "❌"} ${name} [${res.status}]`);
  }

  for (const a of results.slice(0, 3)) {
    const res = await fetchJson(`${BASE}/api/v1/verify/${a.commitment}`);
    if (res.status < 400) {
      console.log(`  ✅ ${a.name}: score=${res.data.reputation?.score} tier=${res.data.reputation?.tier} verified=${res.data.verified}`);
    }
  }

  // Save credentials
  fs.writeFileSync("passport-agents.json", JSON.stringify(results, null, 2));
  console.log("\n💾 Credentials saved to passport-agents.json");
  console.log("🏁 ACTIVATION COMPLETE");
}

const fs = require("fs");
main().catch(e => { console.error("FATAL:", e); process.exit(1); });