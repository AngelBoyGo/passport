import { ErrorTranche, OperationalDomain } from "@prisma/client";
import { sha256Hex } from "@/lib/receipt/canonical";
import { finalizeReceipt, issueReceipt } from "@/lib/receipt-service";
import { operatorIdFromStripe } from "@/lib/operator";
import type { FinalizeReceiptInput, ReceiptStatus } from "@/lib/receipt/types";

/**
 * Consensual agent-trace ingestion.
 *
 * Converts OpenTelemetry-style agent trace spans (the shape emitted by
 * Phoenix / Traceloop / AgentLogs / agent-strace) into Passport receipts.
 *
 * This layer only mints receipts for an operator that owns or has explicitly
 * fed in the traces — it does NOT scrape or score third-party agents. The
 * receipt subject is therefore always an accountable, consenting operator.
 */

export type TraceStatusCode = "OK" | "ERROR" | "UNSET";

/** Minimal subset of an OTel-style agent span that we can map. */
export interface AgentTraceSpan {
  name?: string;
  agent?: { id?: string; name?: string };
  attributes?: Record<string, unknown>;
  status?: { code?: TraceStatusCode | string; message?: string };
  input?: unknown;
  output?: unknown;
  source?: string;
  domain?: string;
}

const DEFAULT_DOMAIN = OperationalDomain.SYSTEM_INTEGRATION;
const UNKNOWN_AGENT_ID = "agent_unknown";

/**
 * Resolves an agent identity across the many shapes producers emit, falling
 * back to a stable sentinel for legacy spans with no identity attribute.
 */
export function resolveAgentIdentity(span: AgentTraceSpan): string {
  const attrs = span.attributes ?? {};
  const candidates: unknown[] = [
    span.agent?.id,
    span.agent?.name,
    attrs["gen_ai.agent.id"],
    attrs["agent.id"],
    attrs["agent.name"],
    attrs["service.name"],
    span.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return UNKNOWN_AGENT_ID;
}

/**
 * Maps a span to an OperationalDomain via explicit enum, then keyword context,
 * defaulting legacy/unknown workloads to SYSTEM_INTEGRATION.
 */
export function resolveDomain(span: AgentTraceSpan): OperationalDomain {
  const explicit =
    span.domain ?? (span.attributes?.["domain"] as string | undefined);
  if (typeof explicit === "string" && explicit in OperationalDomain) {
    return OperationalDomain[explicit as keyof typeof OperationalDomain];
  }

  const haystack = `${span.name ?? ""} ${JSON.stringify(
    span.attributes ?? {}
  )}`.toLowerCase();

  if (/(commit|pull request|\bpr\b|compile|lint|\bcode\b|repo|\bci\b)/.test(haystack)) {
    return OperationalDomain.CODE_GENERATION;
  }
  if (/(payment|invoice|charge|settle|clearing|ledger|billing)/.test(haystack)) {
    return OperationalDomain.FINANCIAL_CLEARING;
  }
  if (/(support|ticket|\bchat\b|customer|helpdesk)/.test(haystack)) {
    return OperationalDomain.CUSTOMER_SUPPORT;
  }
  return DEFAULT_DOMAIN;
}

/**
 * Translates a fault message into a Passport error tranche.
 * Resource-class faults map to COMPUTE_TIMEOUT; everything else to LOGIC_DETECTION.
 */
export function classifyTraceFault(message: string | undefined): ErrorTranche {
  const text = (message ?? "").toLowerCase();
  if (
    /(timeout|timed out|deadline|rate.?limit|token.*exhaust|context.*length|\b429\b|quota)/.test(
      text
    )
  ) {
    return ErrorTranche.COMPUTE_TIMEOUT;
  }
  return ErrorTranche.LOGIC_DETECTION;
}

export interface TraceReceiptPlan {
  agent_id: string;
  domain: OperationalDomain;
  input_digest: string;
  finalize: FinalizeReceiptInput;
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Pure mapping from a trace span to the receipt plan (no DB access).
 * Guarantees a finalize payload that satisfies validateFinalizeInput.
 */
export function mapTraceToReceiptPlan(span: AgentTraceSpan): TraceReceiptPlan {
  const agent_id = resolveAgentIdentity(span);
  const domain = resolveDomain(span);
  const code = (span.status?.code ?? "UNSET").toString().toUpperCase();
  const input_digest = sha256Hex(
    stableStringify(span.input ?? span.name ?? agent_id)
  );

  let finalize: FinalizeReceiptInput;
  if (code === "OK") {
    finalize = {
      status: "success",
      output_hash: sha256Hex(stableStringify(span.output ?? "ok")),
      error_tranche: ErrorTranche.NONE,
    };
  } else if (code === "ERROR") {
    const tranche = classifyTraceFault(span.status?.message);
    const status: ReceiptStatus =
      tranche === ErrorTranche.COMPUTE_TIMEOUT ? "timeout" : "failure_tombstone";
    finalize = {
      status,
      terminal_reason: sha256Hex(span.status?.message ?? status),
      error_tranche: tranche,
    };
  } else {
    finalize = {
      status: "null",
      refusal_reason: sha256Hex(
        span.status?.message ?? "no terminal outcome recorded"
      ),
    };
  }

  return { agent_id, domain, input_digest, finalize };
}

export interface IngestOptions {
  /** Stripe customer id of the consenting operator ingesting these traces. */
  stripeCustomerId: string;
  blind?: boolean;
  authorityScope?: string;
  expiryMs?: number;
  prevReceiptHash?: string;
}

/**
 * Ingests a single trace span as an issued + finalized custody receipt.
 * Custody (observed) rather than competence — ingested traces record what an
 * agent did, they do not authorize new action.
 */
export async function ingestTraceSpan(
  operatorDbId: string,
  span: AgentTraceSpan,
  opts: IngestOptions
): Promise<{ receipt_id: string; plan: TraceReceiptPlan }> {
  const plan = mapTraceToReceiptPlan(span);
  const expiry = new Date(
    Date.now() + (opts.expiryMs ?? 30 * 86_400_000)
  ).toISOString();
  const authority_scope =
    opts.authorityScope ?? `ingest.trace.${span.source ?? "otel"}`;

  const { signed: pending } = await issueReceipt(operatorDbId, {
    operator_id: operatorIdFromStripe(opts.stripeCustomerId),
    agent_id: plan.agent_id,
    receipt_type: "custody",
    input_digest: plan.input_digest,
    authority_scope,
    expiry,
    domain: plan.domain,
    blind: opts.blind,
    prev_receipt_hash: opts.prevReceiptHash,
  });

  const { signed: finalized } = await finalizeReceipt(
    operatorDbId,
    pending.receipt_id,
    plan.finalize
  );

  return { receipt_id: finalized.receipt_id, plan };
}

/**
 * Ingests a batch of spans sequentially, returning one result per span.
 * Sequential issuance preserves chain ordering and ensures no span is dropped.
 */
export async function ingestTraceBatch(
  operatorDbId: string,
  spans: AgentTraceSpan[],
  opts: IngestOptions
): Promise<Array<{ receipt_id: string; plan: TraceReceiptPlan }>> {
  const results: Array<{ receipt_id: string; plan: TraceReceiptPlan }> = [];
  for (const span of spans) {
    results.push(await ingestTraceSpan(operatorDbId, span, opts));
  }
  return results;
}
