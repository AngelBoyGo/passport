/**
 * Passport monkey audit — automated API checks.
 * Run: node audit/run-audit.js
 *
 * Checks authentication, session handling, public endpoints, evidence,
 * rate limiting, and data leakage. For UI-only checks, instructions
 * are printed at the end.
 */

const BASE = process.env.PASSPORT_BASE_URL || "https://passport.metis.gold";
const COMMITMENT = process.env.TEST_COMMITMENT || "87cfa2bfe15782572d40b0669d83504be9409b0475c91db646ec694f279ca2f6";

const PASS = [];
const FAIL = [];

function pass(step, detail = "") {
  PASS.push({ step, detail });
  console.log(`  ✅ [${step}] PASS${detail ? " — " + detail : ""}`);
}

function fail(step, expected, observed) {
  FAIL.push({ step, expected, observed });
  console.log(`  ❌ [${step}] FAIL`);
  console.log(`     Expected: ${expected}`);
  console.log(`     Got:      ${observed}`);
}

async function api(method, path, body = null, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    redirect: "manual",
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, headers: Object.fromEntries(res.headers), body: json };
}

async function checkCacheControl(label, cache, expected) {
  if (!cache) { fail(label, `Cache-Control with ${expected}`, "no Cache-Control header"); return; }
  cache.includes(expected) ? pass(label, cache) : fail(label, `contain ${expected}`, cache);
}

(async () => {
  console.log("=".repeat(60));
  console.log("PASSPORT MONKEY AUDIT");
  console.log("=".repeat(60));
  console.log(`Base URL: ${BASE}`);
  console.log(`Commitment: ${COMMITMENT}`);
  console.log();

  // ── Section 1a: Session without cookie ──
  console.log("--- Section 1: Auth & Session ---");
  let r = await api("GET", "/api/auth/session");
  r.status === 401 ? pass("1a. Session (no cookie)", `${r.status} ${JSON.stringify(r.body)}`)
    : fail("1a. Session (no cookie)", "401", `${r.status}`);
  await checkCacheControl("1a. Cache-Control", r.headers["cache-control"], "no-store");

  // ── Section 1b: Wrong password ──
  r = await api("POST", "/api/auth/login", { email: "izzyblast2010@gmail.com", password: "wrongpassword123" });
  r.status === 401 && r.body?.error
    ? pass("1b. Wrong password", `${r.status} ${r.body.error}`)
    : fail("1b. Wrong password", "401 with {error}", `${r.status} ${JSON.stringify(r.body)}`);
  if (r.headers["x-ratelimit-limit"]) pass("1b. Rate-limit headers present", r.headers["x-ratelimit-limit"] + " req/min");

  // ── Section 1c: Login (user must supply password via env) ──
  const password = process.env.PASSPORT_PASSWORD || "";
  if (password) {
    r = await api("POST", "/api/auth/login", { email: "izzyblast2010@gmail.com", password });
    if (r.status === 200) {
      pass("1c. Login", `200, cookie set: ${r.headers["set-cookie"]?.slice(0, 50)}...`);
      globalThis.sessionCookie = r.headers["set-cookie"];
    } else {
      fail("1c. Login", "200 with cookie", `${r.status} ${JSON.stringify(r.body)}`);
    }
  } else {
    console.log("  ⏭️  1c. Login — skipped (set PASSPORT_PASSWORD env var)");
  }

  // ── Section 1d: Session with cookie ──
  if (globalThis.sessionCookie) {
    r = await api("GET", "/api/auth/session", null, { Cookie: globalThis.sessionCookie });
    r.status === 200 && r.body?.authenticated === true
      ? pass("1d. Authenticated session", `executiveAdmin: ${r.body.executiveAdmin}`)
      : fail("1d. Authenticated session", `200 with authenticated:true`, `${r.status} ${JSON.stringify(r.body)}`);
  }

  // ── Section 2: Public key ──
  console.log("\n--- Section 2: Public Key ---");
  r = await api("GET", "/api/v1/public-key");
  if (r.status === 200 && r.body?.algorithm === "ed25519" && r.body?.public_key?.length === 64) {
    pass("2a. Public key", `${r.body.algorithm} ${r.body.public_key.slice(0, 16)}...`);
  } else {
    fail("2a. Public key", "200, ed25519, 64-hex", `${r.status} ${JSON.stringify(r.body)}`);
  }
  const cc = r.headers["cache-control"] || "";
  cc.includes("immutable")
    ? fail("2a. Cache-Control", "no 'immutable'", cc)
    : pass("2a. No 'immutable'", cc);

  // ── Section 3: Profile & Leaderboard ──
  console.log("\n--- Section 3: Profiles & Leaderboard ---");
  r = await api("GET", `/api/v1/profiles/${COMMITMENT}`);
  if (r.status === 200 && r.body?.enrollment_status === "ENROLLED") {
    pass("3a. Profile", `${r.body.enrollment_status}, evidence: ${r.body.totals?.evidence_count}`);
  } else {
    fail("3a. Profile", "200, ENROLLED", `${r.status} ${JSON.stringify(r.body)}`);
  }

  r = await api("GET", "/api/v1/leaderboard");
  r.status === 200 && Array.isArray(r.body?.leaderboard)
    ? pass("3b. Leaderboard", `${r.body.leaderboard.length} entries`)
    : fail("3b. Leaderboard", "200 with leaderboard array", `${r.status} ${JSON.stringify(r.body)}`);

  // ── Section 4: Evidence ingestion ──
  console.log("\n--- Section 4: Evidence ---");
  r = await api("POST", `/api/v1/passport/agents/${COMMITMENT}/evidence`, {
    source_type: "github_commit_payload",
    payload: {},
    signature: "invalid",
  });
  if ([400, 401].includes(r.status)) {
    pass("4a. Invalid signature", `${r.status} ${r.body?.error || JSON.stringify(r.body)}`);
  } else if (r.status === 500) {
    fail("4a. Invalid signature", "400 or 401", "500 — server error");
  } else {
    fail("4a. Invalid signature", "400 or 401 with error", `${r.status} ${JSON.stringify(r.body)}`);
  }

  // ── Section 5: Rate limiting ──
  console.log("\n--- Section 5: Rate Limiting ---");
  let rateLimited = false;
  for (let i = 0; i < 35; i++) {
    r = await api("POST", "/api/v1/gate/verify", { operator_id: "op_cus_test_abc123", domain: "CODE_GENERATION" });
    if (r.status === 429) { rateLimited = true; break; }
  }
  rateLimited
    ? pass("5a. Gate rate limit", "429 received within 35 requests")
    : fail("5a. Gate rate limit", "429 at or before 35th request", `no 429 after 35 requests`);

  // ── Section 6: Data leakage check ──
  console.log("\n--- Section 6: Data Leakage ---");
  r = await api("GET", `/api/v1/profiles/${COMMITMENT}`);
  if (r.body?.presentation?.photoUrl) {
    r.body.presentation.photoUrl.startsWith("http")
      ? pass("6a. Profile photoUrl is external", r.body.presentation.photoUrl.slice(0, 40))
      : fail("6a. Profile photoUrl", "external URL", r.body.presentation.photoUrl);
  }
  const suspiciousKeys = ["email", "github", "plaintext_identity", "raw_agent_name"];
  const found = suspiciousKeys.filter(k => k in (r.body || {}));
  found.length === 0
    ? pass("6b. No PII in profile", "clean")
    : fail("6b. No PII in profile", "no PII keys", `found: ${found.join(", ")}`);

  // ── Summary ──
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  ✅ PASS: ${PASS.length}`);
  console.log(`  ❌ FAIL: ${FAIL.length}`);
  FAIL.forEach(f => console.log(`       ${f.step}: ${f.expected}`));
  console.log();

  // ── Manual browser checks ──
  console.log("\n--- Manual Browser Checks ---");
  console.log(`Open these pages in a browser to verify UI:`);
  console.log(`  1. ${BASE}/login`);
  console.log(`     → Log in, verify redirect to /admin with dashboard`);
  console.log(`  2. ${BASE}/admin`);
  console.log(`     → Verify command center, health, metrics, executiveAdmin`);
  console.log(`  3. ${BASE}/docs/integrate`);
  console.log(`     → Verify 6 numbered steps`);
  console.log(`  4. ${BASE}/public-key`);
  console.log(`     → Verify key display, badge generator, verify tool`);
  console.log(`  5. ${BASE}/docs/api-reference`);
  console.log(`     → Verify canonicalization section`);
  console.log(`  6. Open DevTools → Application → Cookies`);
  console.log(`     → Verify exactly 1 session_token cookie`);

  process.exit(FAIL.length > 0 ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });