/**
 * Authorization inventory meta-test (Phase 31).
 *
 * The audit found routes that authenticated the CALLER but never authorized the RESOURCE (and
 * some with no gate at all). This test makes the IDOR class non-regressable: every mutating
 * route under reserves/ and raillab/ must contain a recognized authorization marker, or be
 * explicitly allowlisted as signature-gated-in-service or public-by-design. A new unguarded
 * value route therefore fails the suite by name.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const DIRS = ["src/app/api/v1/reserves", "src/app/api/v1/raillab"];
const MUTATING = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
const MARKER =
  /authorizeResource|requireIssuer|authenticateApiKey|verifyAgentIntent|sessionFromRequest|SCHEDULER_SECRET|x-scheduler-secret|verifyPayloadSignature|verifySettlementSignature|timingSafeEqual|constructEvent|verifyBridgeWebhook|requireAdmin/;

/**
 * Routes that are authorized by cryptographic signatures verified inside their service, or are
 * public by design. NOTE: several verify against a caller/registry-supplied key rather than a
 * pinned signer, so a verified signature is not by itself strong authorization — see the Phase-31
 * audit (self-asserted signer keys) for the residual risk.
 */
const ALLOWLIST = new Set<string>([
  "src/app/api/v1/reserves/artisanal/intake/route.ts", // spectrometer Ed25519 sig verified in processOreIntake
  "src/app/api/v1/reserves/industrial/smelt/route.ts", // HSM Ed25519 sig verified in service
  "src/app/api/v1/reserves/fund/milestones/route.ts", // neutral-verifier Ed25519 sig verified in service
  "src/app/api/v1/reserves/quorum/sign/route.ts", // threshold Ed25519 signatures verified in service
  "src/app/api/v1/reserves/transit/arrive/route.ts", // enclave Ed25519 sig verified in service
  "src/app/api/v1/reserves/transit/checkpoint/route.ts", // inspector Ed25519 sig verified in service
  "src/app/api/v1/raillab/discover/route.ts", // public discovery scan (adoption runbook calls it)
  "src/app/api/v1/raillab/health/attestations/verify/route.ts", // public offline verification
]);

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRouteFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

function rel(p: string): string {
  return relative(ROOT, p).split(sep).join("/");
}

describe("Authorization inventory (non-regressable)", () => {
  it("every mutating reserves/raillab route is authorized or explicitly allowlisted", () => {
    const unguarded: string[] = [];
    for (const dir of DIRS) {
      for (const file of findRouteFiles(join(ROOT, dir))) {
        const src = readFileSync(file, "utf8");
        if (!MUTATING.test(src)) continue;
        const r = rel(file);
        if (MARKER.test(src) || ALLOWLIST.has(r)) continue;
        unguarded.push(r);
      }
    }
    expect(
      unguarded,
      `Unguarded mutating routes (add authorizeResource/requireIssuer/verifyAgentIntent or allowlist): ${unguarded.join(", ")}`
    ).toEqual([]);
  });

  it("the inventory actually scans a meaningful number of mutating routes", () => {
    let count = 0;
    for (const dir of DIRS) {
      for (const file of findRouteFiles(join(ROOT, dir))) {
        if (MUTATING.test(readFileSync(file, "utf8"))) count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(15);
  });
});
