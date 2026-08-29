import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import {
  getAgentProfile,
  isValidAgentCommitmentHash,
} from "@/lib/public-portal/portal-service";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ commitment: string }>;
}): Promise<Metadata> {
  const { commitment } = await params;
  const profile = isValidAgentCommitmentHash(commitment)
    ? await getAgentProfile(commitment)
    : null;
  const title = profile
    ? `Agent Trust Report — ${commitment.slice(0, 12)}… — Passport`
    : "Agent Trust Report — Passport";

  return {
    title,
    description: profile
      ? `Verified trust report: ${profile.totals.evidence_count} evidence entries, reputation score. Verify offline with Ed25519.`
      : "Passport — cryptographic identity and authenticity layer for AI agents.",
    openGraph: {
      title,
      description: "Signed, tamper-evident, Merkle-checkpointed agent receipts. Verify offline.",
      type: "website",
      images: profile ? [`https://passport.metis.gold/api/v1/badge/${commitment}/attestation`] : [],
    },
  };
}

export default async function TrustReportPage({
  params,
}: {
  params: Promise<{ commitment: string }>;
}) {
  const { commitment } = await params;

  if (!isValidAgentCommitmentHash(commitment)) {
    notFound();
  }

  const profile = await getAgentProfile(commitment);
  if (!profile) {
    notFound();
  }

  const enrollStatus = await resolveEnrollmentStatus(commitment);
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { publicKey: true, context: true, issuedAt: true },
  });

  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { normalizedEventType: true, artifactType: true, observedAt: true },
    orderBy: { observedAt: "desc" },
    take: 1000,
  });

  const evidenceCount = allEvidence.length;
  const artifactTypes = new Set(allEvidence.map((e) => e.artifactType));
  const corrections = allEvidence.filter((e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length;
  const failures = allEvidence.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;
  const successes = allEvidence.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;

  const cutoff30d = Date.now() - 30 * 86400 * 1000;
  const recent30d = allEvidence.filter((e) => e.observedAt.getTime() > cutoff30d);
  const recent30dSuccesses = recent30d.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;
  const successRate30d = recent30d.length > 0 ? recent30dSuccesses / recent30d.length : null;

  const cutoff7d = Date.now() - 7 * 86400 * 1000;
  const recent7d = allEvidence.filter((e) => e.observedAt.getTime() > cutoff7d);
  const recent7dFailures = recent7d.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;
  const recent7dSuccesses = recent7d.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;
  const trajectory7d = recent7dFailures > recent7dSuccesses ? "DOWN" as const : recent7d.length > 3 ? "UP" as const : "FLAT" as const;

  const rep = computeReputationScore({
    evidenceCount,
    artifactCount: artifactTypes.size,
    correctionCount: corrections,
    failureCount: failures,
    successRate30d,
    trajectory7d,
    isEnrolled: enrollStatus === "ENROLLED",
  });

  const recentReceipts = await prisma.receipt.findMany({
    where: { agentId: commitment },
    orderBy: { issuedAt: "desc" },
    take: 10,
    select: {
      receiptId: true,
      status: true,
      domain: true,
      issuedAt: true,
      signature: true,
      expiry: true,
    },
  });

  const now = Date.now();
  const verified = enrollStatus === "ENROLLED" && evidenceCount > 0;
  const shortHash = `${commitment.slice(0, 12)}…`;
  const baseUrl = "https://passport.metis.gold";

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>

      <div className="mt-6 rounded-xl border bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className={`p-6 ${verified ? "bg-gradient-to-r from-emerald-50 to-white" : "bg-slate-50"}`}>
          <div className="flex items-center gap-3">
            <span className={`text-2xl ${verified ? "" : "text-slate-400"}`}>
              {verified ? "✅" : "❓"}
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {verified ? "Agent Trust Report" : "Agent Profile"}
              </h1>
              <p className="mt-1 text-sm text-slate-500 font-mono break-all">
                {commitment}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              verified ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
            }`}>
              {verified ? "Verified" : "Unverified"}
            </span>
            <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
              style={{ backgroundColor: rep.tierColor + "22", color: rep.tierColor }}>
              {rep.tierLabel}
            </span>
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
              Score: {rep.score}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 font-mono">
              {shortHash}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
          {[
            { label: "Evidence Entries", value: evidenceCount, sub: "total events" },
            { label: "Artifacts", value: artifactTypes.size, sub: "unique types" },
            { label: "Success Rate (30d)", value: successRate30d != null ? `${Math.round(successRate30d * 100)}%` : "—", sub: `${recent30d.length} events` },
            { label: "Trajectory (7d)", value: trajectory7d === "UP" ? "📈 Up" : trajectory7d === "DOWN" ? "📉 Down" : "➡️ Flat", sub: "trending" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stat.value}</p>
              <p className="text-xs text-slate-400">{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* Reputation Breakdown */}
        <div className="p-6 border-t border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Reputation Breakdown</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              {[
                { label: "Evidence", value: rep.breakdown.evidence, max: 500 },
                { label: "Enrollment", value: rep.breakdown.enrollment, max: 100 },
                { label: "Success Rate", value: rep.breakdown.successRate, max: 200 },
                { label: "Trajectory", value: rep.breakdown.trajectory, max: 50 },
                { label: "Artifacts", value: rep.breakdown.artifact, max: 100 },
              ].map((b) => (
                <div key={b.label} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-right text-slate-600">{b.label}</span>
                  <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.min((b.value / b.max) * 100, 100)}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-xs text-slate-500">+{b.value}</span>
                </div>
              ))}
              {corrections > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-right text-amber-600">Corrections</span>
                  <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.min((corrections / 50) * 100, 100)}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-xs text-rose-500">-{rep.breakdown.correctionPenalty}</span>
                </div>
              )}
              {failures > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-right text-red-600">Failures</span>
                  <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-2 rounded-full bg-red-500" style={{ width: `${Math.min((failures / 50) * 100, 100)}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-xs text-rose-500">-{rep.breakdown.failurePenalty}</span>
                </div>
              )}
            </div>
            <div className="rounded-lg bg-slate-50 p-4 space-y-2">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                {rep.nextTier ? (
                  <>
                    <span>Next tier: {rep.nextTier}</span>
                    <span className="text-xs font-normal text-slate-500">({rep.scoreToNextTier} pts away)</span>
                  </>
                ) : (
                  <span>🏆 Maximum tier reached</span>
                )}
              </p>
              <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                <div className="h-2 rounded-full bg-gradient-to-r from-amber-400 via-purple-500 to-indigo-600"
                  style={{ width: `${(rep.score / 1000) * 100}%` }} />
              </div>
              <p className="text-xs text-slate-400">Score range: 0–1000</p>
            </div>
          </div>
        </div>

        {/* Recent Receipts */}
        {recentReceipts.length > 0 && (
          <div className="p-6 border-t border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Recent Receipts</h2>
            <div className="mt-3 space-y-2">
              {recentReceipts.map((r) => {
                const expired = new Date(r.expiry).getTime() < now;
                return (
                  <div key={r.receiptId} className="flex items-center justify-between rounded-lg border bg-slate-50 px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.status === "success" ? "bg-emerald-100 text-emerald-800" :
                        r.status === "pending" ? "bg-amber-100 text-amber-800" :
                        r.status === "refusal" ? "bg-orange-100 text-orange-800" :
                        "bg-red-100 text-red-800"
                      }`}>
                        {r.status}
                      </span>
                      <span className="font-mono text-xs text-slate-400 truncate">{r.receiptId.slice(0, 16)}…</span>
                      {r.domain && <span className="text-xs text-slate-500 hidden sm:inline">{r.domain}</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {expired && <span className="text-xs text-red-500">Expired</span>}
                      {r.signature && <span className="text-xs text-emerald-600">✓ Signed</span>}
                      <span className="text-xs text-slate-400">{new Date(r.issuedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Verify Offline + API */}
        <div className="p-6 border-t border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">Verify Offline</h2>
          <p className="mt-1 text-xs text-slate-500">
            Every receipt is signed with Ed25519. Verify any receipt without calling our API.
          </p>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-300 select-all">
              {`# Verify this agent's trust report via API`}
              <br />
              {`curl -s ${baseUrl}/api/v1/verify/${commitment} | jq`}
            </div>
            <div className="rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-300 select-all">
              {`# Verify a specific receipt offline`}
              <br />
              {`# 1. Fetch the receipt: curl -s ${baseUrl}/api/v1/receipts/{receiptId}/public-manifest`}
              <br />
              {`# 2. Verify Ed25519 signature: npx passport-verify <receipt.json>`}
            </div>
          </div>
        </div>

        {/* Share */}
        <div className="p-6 border-t border-slate-100 bg-white flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {verified ? "This agent is cryptographically verified." : "This agent has no verified evidence."}
          </p>
          <div className="flex gap-2">
            <a
              href={`/profiles/${commitment}`}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Full Profile →
            </a>
            <a
              href={`/leaderboard`}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition"
            >
              Leaderboard ↗
            </a>
          </div>
        </div>
      </div>

      {/* Badge + Embed */}
      <div className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Embed Badge</h2>
        <p className="mt-1 text-xs text-slate-500">Add this badge to your GitHub README to show your agent is verified.</p>
        <div className="mt-3 flex items-center gap-3">
          <img src={`${baseUrl}/api/v1/badge/${commitment}`} alt="Passport Badge" className="h-5" />
          <code className="flex-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 border border-slate-200 select-all">
            {`[![Passport](${baseUrl}/api/v1/badge/${commitment})](${baseUrl}/verify/${commitment})`}
          </code>
        </div>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        Passport — cryptographic identity and authenticity for AI agents.{" "}
        <Link href="/" className="text-indigo-600 underline">passport.metis.gold</Link>
      </p>
    </main>
  );
}