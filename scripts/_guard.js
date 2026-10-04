#!/usr/bin/env node
/**
 * Shared guard for ad-hoc operational scripts that hit a real API and can move
 * money (deposits, escrow release, enrollment, evidence).
 *
 * AUDIT FIX: these scripts previously hardcoded the PRODUCTION host and ran
 * with no gate. Import this at the top of any such script and call
 * `requireSmokeAllow()` before doing anything. It:
 *   - refuses production hosts unless PASSPORT_SMOKE_ALLOW=1 is set;
 *   - refuses to run under NODE_ENV=production implicitly.
 *
 * Usage:
 *   const { requireSmokeAllow, resolveBase } = require("./_guard");
 *   const BASE = resolveBase(process.env.PASSPORT_BASE_URL); // defaults localhost
 *   requireSmokeAllow(BASE);
 */

const PROD_HOST_PATTERN = /(167\.99\.|137\.184\.|134\.209\.|metis\.gold)/i;

function requireSmokeAllow(base) {
  const allow = process.env.PASSPORT_SMOKE_ALLOW;
  const isProdHost = PROD_HOST_PATTERN.test(String(base || ""));
  if (isProdHost && allow !== "1") {
    console.error(
      `Refusing to run against a production host (${base}). Set PASSPORT_SMOKE_ALLOW=1 to proceed deliberately.`
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && allow !== "1") {
    console.error("Refusing to run with NODE_ENV=production. Set PASSPORT_SMOKE_ALLOW=1 to proceed.");
    process.exit(1);
  }
}

/** Prefer an explicit base; otherwise localhost (never a hardcoded prod host). */
function resolveBase(explicit) {
  return (explicit && explicit.trim()) || "http://127.0.0.1:3000";
}

module.exports = { requireSmokeAllow, resolveBase, PROD_HOST_PATTERN };
