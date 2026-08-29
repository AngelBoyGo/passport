import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Embassy — AI Agent Directory — Passport",
  description: "Discover verified AI agents by reputation score, domain, and activity. Every agent is cryptographically verified with Ed25519 receipts.",
  openGraph: {
    title: "Agent Embassy — AI Agent Directory",
    description: "Browse verified AI agents with signed, tamper-evident reputation. Find agents by score, domain, and activity.",
    type: "website",
  },
};

interface AgentCard {
  commitment: string;
  short: string;
  score: number;
  tier: string;
  tierColor: string;
  evidenceCount: number;
  artifactCount: number;
  successRate: string;
  trajectory: string;
  domains: string[];
  firstSeen: string;
  lastSeen: string;
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; min_score?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const domainFilter = params.domain?.toUpperCase() || null;
  const minScore = parseInt(params.min_score || "0", 10);
  const sort = params.sort || "score";

  const grouped = await prisma.agentEvidence.groupBy({
    by: ["agentIdentityCommitment"],
    _count: { _all: true },
    _max: { observedAt: true },
  });

  const top = grouped
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 100);

  const agents: AgentCard[] = [];

  for (const g of top) {
    const hash = g.agentIdentityCommitment;
    const enrollStatus = await resolveEnrollmentStatus(hash);
    if (enrollStatus !== "ENROLLED") continue;

    const allEvidence = await prisma.agentEvidence.findMany({
      where: { agentIdentityCommitment: hash },
      select: { normalizedEventType: true, artifactType: true, observedAt: true },
      take: 500,
    });

    const evidenceCount = allEvidence.length;
    const artifactTypes = new Set(allEvidence.map((e) => e.artifactType));
    const corrections = allEvidence.filter((e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length;
    const failures = allEvidence.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;

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
      isEnrolled: true,
    });

    if (rep.score < minScore) continue;

    const receipts = await prisma.receipt.findMany({
      where: { agentId: hash },
      select: { domain: true },
      distinct: ["domain"],
      take: 5,
    });

    const domains: string[] = receipts
    .map((r) => r.domain)
    .filter((d) => d !== null) as string[];
    if (domainFilter && !domains.some((d) => d.toUpperCase() === domainFilter)) continue;

    const firstEvidence = allEvidence.length > 0 ? allEvidence[allEvidence.length - 1] : null;
    const lastEvidence = allEvidence.length > 0 ? allEvidence[0] : null;

    agents.push({
      commitment: hash,
      short: hash.slice(0, 12),
      score: rep.score,
      tier: rep.tierLabel,
      tierColor: rep.tierColor,
      evidenceCount,
      artifactCount: artifactTypes.size,
      successRate: successRate30d != null ? `${Math.round(successRate30d * 100)}%` : "—",
      trajectory: trajectory7d === "UP" ? "📈" : trajectory7d === "DOWN" ? "📉" : "➡️",
      domains,
      firstSeen: firstEvidence?.observedAt?.toISOString().slice(0, 10) || "—",
      lastSeen: lastEvidence?.observedAt?.toISOString().slice(0, 10) || "—",
    });
  }

  agents.sort((a, b) => {
    if (sort === "evidence") return b.evidenceCount - a.evidenceCount;
    if (sort === "newest") return b.lastSeen.localeCompare(a.lastSeen);
    return b.score - a.score;
  });

  const domains = ["CODE_GENERATION", "FINANCIAL_CLEARING", "CUSTOMER_SUPPORT", "SYSTEM_INTEGRATION"];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>

      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Embassy</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">
            Discover verified AI agents. Every agent is cryptographically verified —
            each action signed with Ed25519, Merkle-checkpointed, publicly verifiable.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {["score", "evidence", "newest"].map((s) => (
            <a
              key={s}
              href={`/agents?sort=${s}${domainFilter ? `&domain=${domainFilter}` : ""}${minScore > 0 ? `&min_score=${minScore}` : ""}`}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                sort === s ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s === "score" ? "By Score" : s === "evidence" ? "By Evidence" : "Newest"}
            </a>
          ))}
        </div>
      </div>

      {/* Domain filter */}
      <div className="mt-6 flex flex-wrap gap-2">
        <a
          href={`/agents?sort=${sort}${minScore > 0 ? `&min_score=${minScore}` : ""}`}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            !domainFilter ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          All
        </a>
        {domains.map((d) => (
          <a
            key={d}
            href={`/agents?domain=${d}&sort=${sort}${minScore > 0 ? `&min_score=${minScore}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              domainFilter === d ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {d.replace(/_/g, " ")}
          </a>
        ))}
      </div>

      {agents.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <p className="text-lg font-semibold text-slate-700">No agents found</p>
          <p className="mt-2 text-sm text-slate-500">
            {domainFilter ? `No agents in ${domainFilter} yet.` : "No verified agents yet. Be the first!"}
          </p>
          <a
            href="/docs/getting-started"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
          >
            Enroll Your Agent →
          </a>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link
              key={agent.commitment}
              href={`/verify/${agent.commitment}`}
              className="rounded-xl border bg-white p-4 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-400">{agent.short}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ backgroundColor: agent.tierColor + "22", color: agent.tierColor }}
                >
                  {agent.tier}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold">{agent.score}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400">Evidence</span>
                  <p className="font-semibold">{agent.evidenceCount}</p>
                </div>
                <div>
                  <span className="text-slate-400">Artifacts</span>
                  <p className="font-semibold">{agent.artifactCount}</p>
                </div>
                <div>
                  <span className="text-slate-400">Success</span>
                  <p className="font-semibold">{agent.successRate}</p>
                </div>
                <div>
                  <span className="text-slate-400">Trend</span>
                  <p className="font-semibold">{agent.trajectory}</p>
                </div>
              </div>
              {agent.domains.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {agent.domains.slice(0, 3).map((d) => (
                    <span key={d} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      {d}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 text-[10px] text-slate-400">
                {agent.lastSeen} — {agent.firstSeen}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-10 text-center">
        <p className="text-xs text-slate-400">
          {agents.length} verified agents ·{" "}
          <Link href="/leaderboard" className="text-indigo-600 underline">Leaderboard →</Link>
        </p>
      </div>
    </main>
  );
}