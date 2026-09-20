import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  const evidence = await prisma.agentEvidence.findFirst({
    where: {
      OR: [
        { id: decodedId },
        { eventCommitmentHash: decodedId },
      ],
    },
    select: {
      eventCommitmentHash: true,
      normalizedEventType: true,
      sourceType: true,
    },
  });

  const title = evidence
    ? `Trace — ${evidence.normalizedEventType} (${evidence.sourceType})`
    : `Trace Verification — ${decodedId.slice(0, 16)}…`;

  return {
    title: `${title} | Passport`,
    description: "Cryptographically verifiable agent execution trace and behavioral evidence record.",
    openGraph: {
      title,
      description: "Cryptographically verifiable agent execution trace and behavioral evidence record on Passport.",
      type: "website",
    },
  };
}

function EventTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    AGENT_RUN_OBSERVED: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    AGENT_ARTIFACT_CREATED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    VALIDATION_OBSERVED: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    HUMAN_CORRECTION_OBSERVED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    EXECUTION_FAILURE_OBSERVED: "bg-red-500/15 text-red-400 border-red-500/30",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
        styles[type] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30"
      }`}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  const evidence = await prisma.agentEvidence.findFirst({
    where: {
      OR: [
        { id: decodedId },
        { eventCommitmentHash: decodedId },
      ],
    },
    include: {
      evidenceReceiptLinks: true,
    },
  });

  if (!evidence) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 text-center text-slate-200">
        <Link href="/admin" className="text-sm text-indigo-400 hover:text-indigo-300 transition">
          ← Back to Admin Console
        </Link>
        <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/60 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-white">Trace Record Not Found</h1>
          <p className="mt-3 text-sm text-slate-400">
            No behavioral trace or evidence record was found matching:{" "}
            <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-indigo-300">
              {decodedId}
            </code>
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              href="/admin/evidence"
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition"
            >
              Browse Evidence Ledger →
            </Link>
            <Link
              href="/leaderboard"
              className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 transition"
            >
              View Public Leaderboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const is64Hex = isValidAgentCommitmentHash(evidence.agentIdentityCommitment);
  const isSystemAgent =
    evidence.agentIdentityCommitment === "scheduler" ||
    evidence.agentIdentityCommitment === "command-brain";

  // Parse formatted source digest if JSON
  let formattedDigest: string | null = null;
  if (evidence.sourceDigest) {
    try {
      const parsed = JSON.parse(evidence.sourceDigest);
      formattedDigest = JSON.stringify(parsed, null, 2);
    } catch {
      formattedDigest = evidence.sourceDigest;
    }
  }

  // Calculate duration if execution timestamps exist
  let durationMs: number | null = null;
  if (evidence.executionStartedAt && evidence.executionFinishedAt) {
    durationMs =
      new Date(evidence.executionFinishedAt).getTime() -
      new Date(evidence.executionStartedAt).getTime();
  }

  return (
    <main className="min-h-screen bg-[#080b12] px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Navigation & breadcrumb */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <Link href="/admin" className="hover:text-white transition">
              Admin
            </Link>
            <span>/</span>
            <Link href="/admin/evidence" className="hover:text-white transition">
              Evidence
            </Link>
            <span>/</span>
            <span className="font-mono text-indigo-300 truncate max-w-[200px]">
              {evidence.eventCommitmentHash.slice(0, 16)}…
            </span>
          </div>
          <Link
            href="/admin/evidence"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 transition"
          >
            ← All Evidence
          </Link>
        </div>

        {/* Hero header */}
        <div className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 sm:p-8 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
                  Cryptographic Trace
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {evidence.artifactType ? `${evidence.artifactType.toUpperCase()} Trace` : "Agent Trace Event"}
              </h1>
            </div>
            <EventTypeBadge type={evidence.normalizedEventType} />
          </div>

          <div className="mt-6 rounded-xl border border-white/5 bg-black/30 p-4 font-mono text-xs">
            <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">
              Event Commitment Hash (SHA-256)
            </p>
            <p className="break-all font-semibold text-indigo-300 select-all">
              {evidence.eventCommitmentHash}
            </p>
          </div>
        </div>

        {/* Primary details grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Identity Card */}
          <section className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              Agent Identity & Provenance
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Agent Commitment</dt>
                <dd className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs break-all text-slate-200">
                    {evidence.agentIdentityCommitment}
                  </span>
                </dd>
                {is64Hex && (
                  <div className="mt-2 flex gap-3">
                    <Link
                      href={`/profiles/${evidence.agentIdentityCommitment}`}
                      className="text-xs text-indigo-400 hover:underline"
                    >
                      View Public Profile →
                    </Link>
                    <Link
                      href={`/verify/${evidence.agentIdentityCommitment}`}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      Verify Passport →
                    </Link>
                  </div>
                )}
                {isSystemAgent && (
                  <span className="mt-2 inline-block rounded border border-indigo-400/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                    System Autopilot Identity ({evidence.agentIdentityCommitment})
                  </span>
                )}
              </div>
              <div className="flex justify-between border-t border-white/5 pt-2">
                <dt className="text-xs text-slate-400">Source Type</dt>
                <dd className="font-mono text-xs text-slate-200">{evidence.sourceType}</dd>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-2">
                <dt className="text-xs text-slate-400">Artifact Type</dt>
                <dd className="font-mono text-xs text-slate-200">{evidence.artifactType}</dd>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-2">
                <dt className="text-xs text-slate-400">Observed At</dt>
                <dd className="text-xs text-slate-200">
                  {new Date(evidence.observedAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </section>

          {/* Execution Metrics */}
          <section className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              Execution Telemetry
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Input Tokens</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">
                  {evidence.tokenUsageInput?.toLocaleString() ?? "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Output Tokens</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">
                  {evidence.tokenUsageOutput?.toLocaleString() ?? "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Tool Calls</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">
                  {evidence.toolCallCount ?? "0"}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Duration</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                  {durationMs != null ? `${(durationMs / 1000).toFixed(2)}s` : "Instant"}
                </p>
              </div>
            </div>

            <div className="border-t border-white/5 pt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Validation Signal</span>
                <span
                  className={
                    evidence.validationSignalPresent
                      ? "text-emerald-400 font-medium"
                      : "text-slate-500"
                  }
                >
                  {evidence.validationSignalPresent ? "✓ Present & Attested" : "Observational only"}
                </span>
              </div>
              {evidence.rawErrorClassification && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Error Classification</span>
                  <span className="text-red-400 font-mono">{evidence.rawErrorClassification}</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Code & Task Context */}
        {(evidence.commitSha || evidence.repositoryCommitment || evidence.externalTaskId || evidence.sourceUrl) && (
          <section className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              Repository & Task Context
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2 text-xs">
              {evidence.externalTaskId && (
                <div>
                  <dt className="text-slate-400">External Task ID</dt>
                  <dd className="mt-0.5 font-mono text-slate-200">{evidence.externalTaskId}</dd>
                </div>
              )}
              {evidence.commitSha && (
                <div>
                  <dt className="text-slate-400">Commit SHA</dt>
                  <dd className="mt-0.5 font-mono text-indigo-300">{evidence.commitSha}</dd>
                </div>
              )}
              {evidence.repositoryCommitment && (
                <div>
                  <dt className="text-slate-400">Repository Commitment</dt>
                  <dd className="mt-0.5 font-mono text-slate-200 truncate">
                    {evidence.repositoryCommitment}
                  </dd>
                </div>
              )}
              {evidence.sourceUrl && (
                <div>
                  <dt className="text-slate-400">Source URL</dt>
                  <dd className="mt-0.5 truncate">
                    <a
                      href={evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:underline"
                    >
                      {evidence.sourceUrl}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Source Digest / Payload Viewer */}
        {formattedDigest && (
          <section className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                Source Digest Payload
              </h2>
              <span className="text-[10px] text-slate-500">Immutable JSON</span>
            </div>
            <pre className="max-h-96 overflow-auto rounded-xl border border-white/5 bg-black/40 p-4 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
              {formattedDigest}
            </pre>
          </section>
        )}

        {/* Linked Behavioral Receipts */}
        {evidence.evidenceReceiptLinks && evidence.evidenceReceiptLinks.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-[#0e131d] p-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              Linked Signed Receipts ({evidence.evidenceReceiptLinks.length})
            </h2>
            <div className="divide-y divide-white/5">
              {evidence.evidenceReceiptLinks.map((link) => (
                <div key={link.id} className="flex items-center justify-between py-3 text-xs">
                  <div>
                    <Link
                      href={`/verify/${link.receiptId}`}
                      className="font-mono text-indigo-400 hover:underline font-semibold"
                    >
                      {link.receiptId}
                    </Link>
                    <p className="mt-0.5 text-slate-400 text-[11px]">
                      Type: {link.linkageType} · State: {link.enforcementState}
                    </p>
                  </div>
                  <Link
                    href={`/verify/${link.receiptId}`}
                    className="rounded bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10 transition"
                  >
                    Verify Receipt →
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
