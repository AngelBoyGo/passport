/**
 * Live production audit for passport.metis.gold (or any deployed Passport instance).
 *
 * Run:
 *   npx tsx scripts/live-production-audit.ts
 *
 * Required env:
 *   PASSPORT_PRODUCTION_URL          — e.g. https://passport.metis.gold
 *   PASSPORT_PRODUCTION_ADMIN_KEY    — Bearer API key for POST /api/v1/receipts (minted by Stripe webhook)
 *
 * Alias (same value as ADMIN_KEY):
 *   PASSPORT_PRODUCTION_API_KEY
 *
 * Optional env:
 *   PASSPORT_PRODUCTION_OPERATOR_ID  — public operator id (op_cus_...) for gate queries; inferred from receipt if omitted
 *
 * API behavior reconciliations (read gate + receipts routes before changing assertions):
 *
 * | Endpoint                         | Condition                    | HTTP | Body |
 * |----------------------------------|------------------------------|------|------|
 * | POST /api/v1/gate/verify         | unknown op_cus_* operator    | 404  | { error: "Operator not found" } |
 * | POST /api/v1/gate/verify         | known operator, zero tenancy | 200  | { allow_invocation: false, reason: "ZERO_TENANCY_REJECT" } |
 * | POST /api/v1/receipts            | gate ZERO_TENANCY_REJECT     | 403  | { error: "Gate denied", reason: "ZERO_TENANCY_REJECT" } |
 * | POST /api/v1/gate/verify         | failure rate > 10% (3+/20)   | 200  | { allow_invocation: false, reason: "SLA_BREACH_THRESHOLD_EXCEEDED" } |
 * | GET  /api/health                 | DB reachable                 | 200  | { status: "ok" } |
 * | GET  /api/health                 | DB down / timeout            | 503  | { status: "unavailable" } |
 *
 * Action A tests unknown-operator 404 and ZERO_TENANCY via gate query (not 403 — that status is receipt-issue only).
 * Action B requires a domain with allow_invocation:true (prior successful receipts). Fresh checkout operators
 * have zero tenancy everywhere; seed one successful receipt manually or use an operator with history.
 * Action C loops fault receipts until SLA_BREACH_THRESHOLD_EXCEEDED on the Action B domain.
 */
import { randomBytes } from "node:crypto";
import { PassportClient, OPERATIONAL_DOMAINS } from "../sdk/dist/index.mjs";
import type { OperationalDomain } from "../sdk/dist/index.mjs";
import { configureEd25519 } from "../src/lib/receipt/crypto";
import { sha256Hex } from "../src/lib/receipt/canonical";
import { verifyReceipt } from "../src/lib/receipt/verify";
import type { ReceiptPayload } from "../src/lib/receipt/types";

configureEd25519();

const AUDIT_AGENT_ID = "live-production-audit-agent";
const MAX_SLA_SEED_ATTEMPTS = 25;
const GATE_POLL_INTERVAL_MS = 200;

interface AuditContext {
  baseUrl: string;
  apiKey: string;
  operatorId: string | null;
  client: PassportClient;
  failures: string[];
}

/**
 * Resolves a required env var, optionally accepting a fallback name.
 */
function requireEnv(primary: string, alias?: string): string {
  const value = process.env[primary] ?? (alias ? process.env[alias] : undefined);
  if (!value?.trim()) {
    const names = alias ? `${primary} or ${alias}` : primary;
    throw new Error(
      `Missing required env var: ${names}\n\n` +
        `Example:\n` +
        `  set PASSPORT_PRODUCTION_URL=https://passport.metis.gold\n` +
        `  set PASSPORT_PRODUCTION_ADMIN_KEY=pp_live_...\n` +
        `  set PASSPORT_PRODUCTION_OPERATOR_ID=op_cus_...\n` +
        `  npx tsx scripts/live-production-audit.ts`
    );
  }
  return value.trim().replace(/\/$/, "");
}

/**
 * Records a failure and dumps the raw HTTP response for teardown diagnostics.
 */
async function fail(
  ctx: AuditContext,
  step: string,
  message: string,
  response?: Response,
  bodyText?: string
): Promise<never> {
  const parts = [`[${step}] ${message}`];
  if (response) {
    parts.push(`HTTP ${response.status} ${response.statusText}`);
    parts.push(`Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);
  }
  if (bodyText !== undefined) {
    parts.push(`Body: ${bodyText}`);
  }
  ctx.failures.push(parts.join("\n"));
  throw new Error(parts.join("\n"));
}

/**
 * Asserts ed25519 signature field shape on a signed receipt payload.
 */
function assertSignatureFormat(receipt: ReceiptPayload, step: string): void {
  if (typeof receipt.signature !== "string") {
    throw new Error(`[${step}] Missing signature on receipt ${receipt.receipt_id}`);
  }
  if (!/^[0-9a-f]{128}$/i.test(receipt.signature)) {
    throw new Error(
      `[${step}] signature must be 128 hex chars (ed25519), got length ${receipt.signature.length}`
    );
  }
  if (typeof receipt.content_hash !== "string" || !/^[0-9a-f]+$/i.test(receipt.content_hash)) {
    throw new Error(`[${step}] content_hash must be lowercase hex`);
  }
}

/**
 * Fetches the published verifying key from the live deployment.
 */
async function fetchPublicKeyHex(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/public-key`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Public key fetch failed HTTP ${res.status}: ${text}`);
  }
  const body = JSON.parse(text) as { algorithm?: string; public_key?: string };
  if (body.algorithm !== "ed25519" || typeof body.public_key !== "string") {
    throw new Error(`Unexpected public-key shape: ${text}`);
  }
  return body.public_key;
}

/**
 * Step 1 — DB-backed health probe.
 */
async function checkHealth(ctx: AuditContext): Promise<void> {
  const res = await fetch(`${ctx.baseUrl}/api/health`);
  const text = await res.text();
  if (!res.ok) {
    await fail(ctx, "health", `Expected HTTP 200, got ${res.status}`, res, text);
  }
  let body: { status?: string };
  try {
    body = JSON.parse(text);
  } catch {
    await fail(ctx, "health", "Response is not JSON", res, text);
  }
  if (body.status !== "ok") {
    await fail(ctx, "health", `Expected status "ok", got ${JSON.stringify(body)}`, res, text);
  }
  console.log("[health] OK —", text);
}

/**
 * Step 2A — Unknown operator returns 404 (not 403).
 */
async function actionUnknownOperator(ctx: AuditContext): Promise<void> {
  const fakeId = `op_cus_nonexistent_${randomBytes(4).toString("hex")}`;
  const res = await fetch(`${ctx.baseUrl}/api/v1/gate/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operator_id: fakeId,
      domain: "SYSTEM_INTEGRATION",
    }),
  });
  const text = await res.text();
  if (res.status !== 404) {
    await fail(
      ctx,
      "action-a-unknown",
      `Unknown operator must return 404 (not 403). Got ${res.status}`,
      res,
      text
    );
  }
  const body = JSON.parse(text) as { error?: string };
  if (body.error !== "Operator not found") {
    await fail(
      ctx,
      "action-a-unknown",
      `Expected error "Operator not found", got ${text}`,
      res,
      text
    );
  }
  console.log("[action-a] Unknown operator correctly rejected with 404");
}

/**
 * Step 2B — ZERO_TENANCY via gate query (HTTP 200, not 403).
 */
async function actionZeroTenancy(ctx: AuditContext, operatorId: string): Promise<void> {
  const res = await fetch(`${ctx.baseUrl}/api/v1/gate/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operator_id: operatorId,
      domain: "CUSTOMER_SUPPORT",
    }),
  });
  const text = await res.text();
  if (res.status !== 200) {
    await fail(
      ctx,
      "action-a-zero-tenancy",
      `Gate query must return 200 for ZERO_TENANCY (403 is receipt-issue only). Got ${res.status}`,
      res,
      text
    );
  }
  const body = JSON.parse(text) as { allow_invocation?: boolean; reason?: string };
  if (body.allow_invocation !== false || body.reason !== "ZERO_TENANCY_REJECT") {
    await fail(
      ctx,
      "action-a-zero-tenancy",
      `Expected ZERO_TENANCY_REJECT on unseeded CUSTOMER_SUPPORT, got ${text}`,
      res,
      text
    );
  }
  console.log("[action-a] ZERO_TENANCY_REJECT confirmed via gate query (HTTP 200)");
}

/**
 * Finds the first operational domain where the operator may issue receipts.
 */
async function findWritableDomain(
  client: PassportClient,
  operatorId: string
): Promise<OperationalDomain | null> {
  for (const domain of OPERATIONAL_DOMAINS) {
    const gate = await client.queryGate(operatorId, domain);
    if (gate.allow_invocation) {
      return domain;
    }
  }
  return null;
}

/**
 * Step 3 — Issue, verify signature, finalize with COMPUTE_TIMEOUT.
 */
async function actionReceiptLifecycle(
  ctx: AuditContext,
  operatorIdHint: string | null
): Promise<{ domain: OperationalDomain; operatorId: string }> {
  let domain: OperationalDomain | null = null;
  if (operatorIdHint) {
    domain = await findWritableDomain(ctx.client, operatorIdHint);
  }
  if (!domain) {
    for (const candidate of OPERATIONAL_DOMAINS) {
      try {
        const probe = (await ctx.client.issueReceipt({
          agent_id: AUDIT_AGENT_ID,
          receipt_type: "competence",
          input_digest: sha256Hex(`bootstrap-probe-${candidate}-${Date.now()}`),
          authority_scope: "live.production.audit.bootstrap",
          expiry: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          domain: candidate,
        })) as ReceiptPayload;

        domain = candidate;
        console.log(
          `[action-b] Bootstrapped via issue on ${domain} (receipt ${probe.receipt_id})`
        );

        const publicKeyHex = await fetchPublicKeyHex(ctx.baseUrl);
        assertSignatureFormat(probe, "action-b-bootstrap");
        const probeVerify = await verifyReceipt(probe, publicKeyHex);
        if (!probeVerify.valid) {
          throw new Error(
            `[action-b] Bootstrap receipt signature invalid: ${probeVerify.error}`
          );
        }

        const finalized = (await ctx.client.finalizeReceipt(probe.receipt_id, {
          status: "timeout",
          terminal_reason: "live audit COMPUTE_TIMEOUT tranche",
          error_tranche: "COMPUTE_TIMEOUT",
        })) as ReceiptPayload;

        assertSignatureFormat(finalized, "action-b-finalize");
        if (finalized.error_tranche !== "COMPUTE_TIMEOUT") {
          throw new Error(
            `[action-b] Expected error_tranche COMPUTE_TIMEOUT, got ${String(finalized.error_tranche)}`
          );
        }
        const finalVerify = await verifyReceipt(finalized, publicKeyHex);
        if (!finalVerify.valid) {
          throw new Error(
            `[action-b] Finalized receipt signature invalid: ${finalVerify.error}`
          );
        }
        console.log(
          `[action-b] Finalized bootstrap with COMPUTE_TIMEOUT — signature re-verified`
        );

        const resolvedOperatorId =
          typeof finalized.operator_id === "string" ? finalized.operator_id : "";
        if (!resolvedOperatorId) {
          throw new Error("[action-b] Could not infer operator_id from finalized receipt");
        }
        return { domain, operatorId: resolvedOperatorId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ZERO_TENANCY") || message.includes("Gate denied")) {
          continue;
        }
        throw err;
      }
    }
  }
  if (!domain) {
    throw new Error(
      "[action-b] No domain with allow_invocation:true. Fresh Pro operators have zero tenancy in every domain.\n" +
        "Bootstrap: complete at least one successful receipt in any domain (or use an operator with history), then re-run."
    );
  }
  console.log(`[action-b] Using writable domain: ${domain}`);

  const publicKeyHex = await fetchPublicKeyHex(ctx.baseUrl);
  const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const inputDigest = sha256Hex(`live-audit-input-${Date.now()}`);

  const issued = (await ctx.client.issueReceipt({
    agent_id: AUDIT_AGENT_ID,
    receipt_type: "competence",
    input_digest: inputDigest,
    authority_scope: "live.production.audit",
    expiry,
    domain,
  })) as ReceiptPayload;

  assertSignatureFormat(issued, "action-b-issue");
  const issueVerify = await verifyReceipt(issued, publicKeyHex);
  if (!issueVerify.valid) {
    throw new Error(`[action-b] Issued receipt signature invalid: ${issueVerify.error}`);
  }
  console.log(`[action-b] Issued ${issued.receipt_id} — ed25519 signature verified`);

  const finalized = (await ctx.client.finalizeReceipt(issued.receipt_id, {
    status: "timeout",
    terminal_reason: "live audit COMPUTE_TIMEOUT tranche",
    error_tranche: "COMPUTE_TIMEOUT",
  })) as ReceiptPayload;

  assertSignatureFormat(finalized, "action-b-finalize");
  if (finalized.error_tranche !== "COMPUTE_TIMEOUT") {
    throw new Error(
      `[action-b] Expected error_tranche COMPUTE_TIMEOUT, got ${String(finalized.error_tranche)}`
    );
  }
  const finalVerify = await verifyReceipt(finalized, publicKeyHex);
  if (!finalVerify.valid) {
    throw new Error(`[action-b] Finalized receipt signature invalid: ${finalVerify.error}`);
  }
  console.log(
    `[action-b] Finalized with COMPUTE_TIMEOUT — status=${finalized.status}, signature re-verified`
  );

  const resolvedOperatorId =
    typeof finalized.operator_id === "string"
      ? finalized.operator_id
      : operatorIdHint ?? "";
  if (!resolvedOperatorId) {
    throw new Error("[action-b] Could not infer operator_id from finalized receipt");
  }
  return { domain, operatorId: resolvedOperatorId };
}

/**
 * Step 4 — Poll gate and seed fault receipts until SLA_BREACH_THRESHOLD_EXCEEDED.
 */
async function actionSlaBreach(
  ctx: AuditContext,
  operatorId: string,
  domain: OperationalDomain
): Promise<void> {
  for (let attempt = 0; attempt < MAX_SLA_SEED_ATTEMPTS; attempt++) {
    const gate = await ctx.client.queryGate(operatorId, domain);
    console.log(`[action-c] Gate poll #${attempt + 1}:`, JSON.stringify(gate));

    if (
      gate.allow_invocation === false &&
      gate.reason === "SLA_BREACH_THRESHOLD_EXCEEDED"
    ) {
      console.log("[action-c] SLA_BREACH_THRESHOLD_EXCEEDED confirmed");
      return;
    }

    if (gate.allow_invocation === false && gate.reason === "ZERO_TENANCY_REJECT") {
      throw new Error(
        "[action-c] Unexpected ZERO_TENANCY after Action B — domain history missing"
      );
    }

    if (!gate.allow_invocation) {
      throw new Error(`[action-c] Unexpected gate denial: ${JSON.stringify(gate)}`);
    }

    const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const issued = await ctx.client.issueReceipt({
      agent_id: AUDIT_AGENT_ID,
      receipt_type: "competence",
      input_digest: sha256Hex(`sla-seed-${attempt}-${Date.now()}`),
      authority_scope: "live.production.audit.sla",
      expiry,
      domain,
    });

    await ctx.client.finalizeReceipt(issued.receipt_id, {
      status: "failure_tombstone",
      terminal_reason: "live audit SLA seed fault",
      error_tranche: "SLA_BREACH",
    });

    await new Promise((r) => setTimeout(r, GATE_POLL_INTERVAL_MS));
  }

  throw new Error(
    `[action-c] SLA_BREACH_THRESHOLD_EXCEEDED not reached after ${MAX_SLA_SEED_ATTEMPTS} fault seeds`
  );
}

/**
 * Prints the success markdown report.
 */
function printSecureReport(ctx: AuditContext): void {
  console.log("\n---\n");
  console.log("# PASSPORT GENESIS NETWORK STATUS: SECURE\n");
  console.log(`| Check | Result |`);
  console.log(`|-------|--------|`);
  console.log(`| Health | \`200 { status: "ok" }\` |`);
  console.log(`| Unknown operator | \`404 Operator not found\` |`);
  console.log(`| Zero tenancy (gate) | \`200 ZERO_TENANCY_REJECT\` |`);
  console.log(`| Receipt issue + ed25519 | Verified |`);
  console.log(`| COMPUTE_TIMEOUT finalize | Verified |`);
  console.log(`| SLA breach gate | \`SLA_BREACH_THRESHOLD_EXCEEDED\` |`);
  console.log(`\nTarget: ${ctx.baseUrl}`);
  console.log(`Operator: ${ctx.operatorId ?? "(from receipt)"}`);
  console.log("\n---\n");
}

async function main() {
  const baseUrl = requireEnv("PASSPORT_PRODUCTION_URL");
  const apiKey = requireEnv("PASSPORT_PRODUCTION_ADMIN_KEY", "PASSPORT_PRODUCTION_API_KEY");
  const operatorIdEnv = process.env.PASSPORT_PRODUCTION_OPERATOR_ID?.trim() ?? null;

  const ctx: AuditContext = {
    baseUrl,
    apiKey,
    operatorId: operatorIdEnv,
    client: new PassportClient({ baseUrl, apiKey }),
    failures: [],
  };

  console.log("=== Passport live production audit ===\n");
  console.log(`Target: ${baseUrl}`);
  console.log(`API key: ${apiKey.slice(0, 12)}…`);
  if (operatorIdEnv) {
    console.log(`Operator: ${operatorIdEnv}`);
  } else {
    console.log("Operator: (will infer from Action B receipt)");
  }
  console.log();

  try {
    await checkHealth(ctx);
    await actionUnknownOperator(ctx);

    const { domain, operatorId } = await actionReceiptLifecycle(ctx, operatorIdEnv);
    ctx.operatorId = operatorId;

    await actionZeroTenancy(ctx, operatorId);
    await actionSlaBreach(ctx, operatorId, domain);

    printSecureReport(ctx);
    process.exit(0);
  } catch (err) {
    console.error("\n=== AUDIT FAILED ===\n");
    if (ctx.failures.length > 0) {
      console.error("Captured failures:\n");
      for (const f of ctx.failures) {
        console.error(f);
        console.error("---");
      }
    }
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
