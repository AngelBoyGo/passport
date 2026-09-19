/**
 * Brain self-research scan (Phase 40).
 *
 * Automates the manual loop we previously ran by hand: the brain gathers its own
 * telemetry (evidence trends, wallet supply, disputes, rails, recent failures),
 * asks the LLM to produce a structured audit with findings and improvement
 * hypotheses, and persists the result as signed-registry evidence.
 *
 * This is deliberately INTERNAL research: it reads system state the brain already
 * owns and writes findings as evidence. It performs NO state changes and moves NO
 * money. External web research requires a search provider and is intentionally out
 * of scope here.
 *
 * Findings are informational only — they enter the next cycle's memory as evidence
 * and never execute directly.
 */

import { prisma } from "@/lib/db";
import { brainComplete, parseJsonObject } from "@/lib/raillab/factory-brain";

export interface ResearchFinding {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
  recommendation: string;
}

export interface ResearchHypothesis {
  objective: string;
  expected_improvement: string;
  risk: "low" | "medium" | "high";
}

export interface ResearchScanResult {
  scanId: string;
  findings: ResearchFinding[];
  hypotheses: ResearchHypothesis[];
  telemetry: Record<string, number>;
  llm_used: boolean;
}

export interface ResearchScanDeps {
  complete?: typeof brainComplete;
  now?: () => Date;
}

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const RISKS = new Set(["low", "medium", "high"]);

/**
 * Gathers bounded internal telemetry for the scan. Every read is best-effort
 * (count queries only — no unbounded scans) and defaults to -1 ("unknown") on
 * failure so the LLM can distinguish missing data from zero.
 */
export async function gatherResearchTelemetry(now: Date): Promise<Record<string, number>> {
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const [evidence7d, evidenceTotal, runEvents7d, artifactEvents7d, failures7d, corrections7d, wallets, disputesOpen, railsEnabled, railsQuarantined, receipts, brainOutcomes7d] =
    await Promise.all([
      prisma.agentEvidence.count({ where: { observedAt: { gte: since7d } } }).catch(() => -1),
      prisma.agentEvidence.count().catch(() => -1),
      prisma.agentEvidence.count({ where: { observedAt: { gte: since7d }, normalizedEventType: "AGENT_RUN_OBSERVED" } }).catch(() => -1),
      prisma.agentEvidence.count({ where: { observedAt: { gte: since7d }, normalizedEventType: "AGENT_ARTIFACT_CREATED" } }).catch(() => -1),
      prisma.agentEvidence.count({ where: { observedAt: { gte: since7d }, normalizedEventType: "EXECUTION_FAILURE_OBSERVED" } }).catch(() => -1),
      prisma.agentEvidence.count({ where: { observedAt: { gte: since7d }, normalizedEventType: "HUMAN_CORRECTION_OBSERVED" } }).catch(() => -1),
      prisma.agentWallet.count().catch(() => -1),
      prisma.computeDispute.count({ where: { status: "OPEN" } }).catch(() => -1),
      prisma.railSpec.count({ where: { state: "ENABLED" } }).catch(() => -1),
      prisma.railSpec.count({ where: { state: "QUARANTINED" } }).catch(() => -1),
      prisma.receipt.count().catch(() => -1),
      prisma.brainMemory.count({ where: { kind: "OUTCOME", createdAt: { gte: since7d } } }).catch(() => -1),
    ]);

  return {
    evidence_7d: evidence7d,
    evidence_total: evidenceTotal,
    agent_runs_7d: runEvents7d,
    artifacts_7d: artifactEvents7d,
    failures_7d: failures7d,
    human_corrections_7d: corrections7d,
    wallets: wallets,
    disputes_open: disputesOpen,
    rails_enabled: railsEnabled,
    rails_quarantined: railsQuarantined,
    receipts_total: receipts,
    brain_outcomes_7d: brainOutcomes7d,
  };
}

/** Coerces the LLM JSON into typed findings/hypotheses, dropping malformed rows. */
export function parseResearchScan(raw: Record<string, unknown>): {
  findings: ResearchFinding[];
  hypotheses: ResearchHypothesis[];
} {
  const findings: ResearchFinding[] = [];
  const hypotheses: ResearchHypothesis[] = [];

  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  for (const f of rawFindings.slice(0, 10)) {
    if (!f || typeof f !== "object") continue;
    const obj = f as Record<string, unknown>;
    const title = String(obj.title ?? "").trim();
    const evidence = String(obj.evidence ?? "").trim();
    const recommendation = String(obj.recommendation ?? "").trim();
    const severity = String(obj.severity ?? "low").toLowerCase();
    if (!title || !evidence || !recommendation) continue;
    findings.push({
      title: title.slice(0, 200),
      severity: (SEVERITIES.has(severity) ? severity : "low") as ResearchFinding["severity"],
      evidence: evidence.slice(0, 1000),
      recommendation: recommendation.slice(0, 500),
    });
  }

  const rawHypotheses = Array.isArray(raw.hypotheses) ? raw.hypotheses : [];
  for (const h of rawHypotheses.slice(0, 5)) {
    if (!h || typeof h !== "object") continue;
    const obj = h as Record<string, unknown>;
    const objective = String(obj.objective ?? "").trim();
    const expected = String(obj.expected_improvement ?? "").trim();
    const risk = String(obj.risk ?? "low").toLowerCase();
    if (!objective || !expected) continue;
    hypotheses.push({
      objective: objective.slice(0, 300),
      expected_improvement: expected.slice(0, 300),
      risk: (RISKS.has(risk) ? risk : "low") as ResearchHypothesis["risk"],
    });
  }

  return { findings, hypotheses };
}

/**
 * Runs one bounded self-research scan. Never throws — on LLM failure returns a
 * result with llm_used=false and the telemetry retained (fail-open for READ-ONLY
 * research; the cycle itself fails closed elsewhere).
 */
export async function runResearchScan(
  now: Date = new Date(),
  deps: ResearchScanDeps = {},
  focus?: string
): Promise<ResearchScanResult> {
  const scanId = `rescan_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const complete = deps.complete ?? brainComplete;

  const telemetry = await gatherResearchTelemetry(now);

  let findings: ResearchFinding[] = [];
  let hypotheses: ResearchHypothesis[] = [];
  let llmUsed = false;

  try {
    const raw = await complete({
      system:
        "You are the Passport ASMC-3 Command Brain's self-research module. You are auditing the " +
        "system you run: a commodity-backed autonomous-agent economy (AngelCoin, evidence ledger, " +
        "settlement rails, Sahel corridors). Given telemetry, identify the most important findings " +
        "(anomalies, risks, stale data, improvement opportunities) and 1-3 concrete improvement " +
        "hypotheses testable in replay/sandbox. Use -1 telemetry values to mean UNKNOWN — never " +
        "assume unknown means healthy. Return STRICT JSON: " +
        '{"findings": [{"title": str, "severity": "low"|"medium"|"high"|"critical", "evidence": str, "recommendation": str}], ' +
        '"hypotheses": [{"objective": str, "expected_improvement": str, "risk": "low"|"medium"|"high"}]}. ' +
        "No prose outside the JSON object.",
      user: JSON.stringify({ scan_id: scanId, focus: focus ?? null, telemetry }),
      json: true,
      temperature: 0.2,
    });
    const parsed = parseJsonObject(raw);
    const out = parseResearchScan(parsed);
    findings = out.findings;
    hypotheses = out.hypotheses;
    llmUsed = true;
  } catch {
    // Fail-open for read-only research: telemetry is still persisted as evidence
    // so the next cycle (and humans) can see the scan ran and what it saw.
  }

  // Persist the scan as evidence — the brain's research enters the shared record.
  try {
    await prisma.agentEvidence.create({
      data: {
        sourceType: "brain_research_scan",
        artifactType: "report",
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: now,
        agentIdentityCommitment: "command-brain",
        eventCommitmentHash: `${scanId}_${Math.random().toString(36).slice(2, 8)}`,
        sourceDigest: JSON.stringify({ scan_id: scanId, telemetry, findings, hypotheses, llm_used: llmUsed }).slice(0, 10_000),
        validationSignalPresent: llmUsed,
      },
    });
  } catch {
    // Non-fatal: scan result is still returned to the caller.
  }

  return { scanId, findings, hypotheses, telemetry, llm_used: llmUsed };
}