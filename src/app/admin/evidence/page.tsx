"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface EvidenceRecord {
  id: string;
  sourceType: string;
  artifactType: string;
  normalizedEventType: string;
  rawErrorClassification: string | null;
  observedAt: string;
  agentIdentityCommitment: string;
  eventCommitmentHash: string;
  validationSignalPresent: boolean;
  tokenUsageInput: number | null;
  tokenUsageOutput: number | null;
  toolCallCount: number | null;
  externalTaskId: string | null;
  commitSha: string | null;
}

interface EvidenceData {
  total: number;
  sources: Array<{ type: string; count: number }>;
  eventTypes: Array<{ type: string; count: number }>;
  evidence: EvidenceRecord[];
}

export default function AdminEvidencePage() {
  const [data, setData] = useState<EvidenceData | null>(null);
  const [sourceType, setSourceType] = useState<string>("");
  const [eventType, setEventType] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("agent");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read deep-link filter on mount
      if (p) setAgentFilter(p);
    }
  }, []);

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (sourceType) params.set("sourceType", sourceType);
    if (eventType) params.set("eventType", eventType);
    if (agentFilter) params.set("agent", agentFilter);
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/admin/evidence?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`Failed to load evidence (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sourceType, eventType, agentFilter, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount/filters
    loadEvidence();
  }, [loadEvidence]);

  function eventTypeBadge(type: string) {
    const styles: Record<string, string> = {
      AGENT_RUN_OBSERVED: "bg-blue-100 text-blue-800",
      AGENT_ARTIFACT_CREATED: "bg-emerald-100 text-emerald-800",
      VALIDATION_OBSERVED: "bg-purple-100 text-purple-800",
      HUMAN_CORRECTION_OBSERVED: "bg-amber-100 text-amber-800",
      EXECUTION_FAILURE_OBSERVED: "bg-red-100 text-red-800",
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[type] ?? "bg-slate-100 text-slate-700"}`}>
        {type.replace(/_/g, " ")}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Evidence Observed</h1>
          <p className="text-sm text-slate-500">
            Immutable behavioral telemetry, task deliverables, and cryptographic execution traces.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {agentFilter && (
            <button
              onClick={() => setAgentFilter("")}
              className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition"
            >
              Filtering for 1 agent (Clear) ✕
            </button>
          )}
          <button
            onClick={loadEvidence}
            className="rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by event hash, agent commitment, task ID…"
            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm bg-white"
          >
            <option value="">All Sources</option>
            {data?.sources.map((s) => (
              <option key={s.type} value={s.type}>
                {s.type} ({s.count})
              </option>
            ))}
          </select>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm bg-white"
          >
            <option value="">All Event Types</option>
            {data?.eventTypes.map((t) => (
              <option key={t.type} value={t.type}>
                {t.type} ({t.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Evidence Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading observed evidence…</div>
        ) : !data || data.evidence.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-medium text-slate-800">No evidence records found</p>
            <p className="mt-1 text-sm text-slate-500">
              {search || sourceType || eventType || agentFilter
                ? "Try clearing your filters."
                : "Observed evidence will appear here as agent traces are ingested."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm divide-y divide-slate-100">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Event Hash</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Event Type</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Validation</th>
                  <th className="px-4 py-3">Observed At</th>
                  <th className="px-4 py-3 text-right">Traceable Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.evidence.map((ev) => {
                  const isSystem =
                    ev.agentIdentityCommitment === "scheduler" ||
                    ev.agentIdentityCommitment === "command-brain";
                  return (
                    <tr key={ev.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3">
                        <Link
                          href={`/trace/${ev.id}`}
                          className="font-mono text-xs font-semibold text-indigo-600 hover:underline"
                          title={ev.eventCommitmentHash}
                        >
                          {ev.eventCommitmentHash.slice(0, 16)}…
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {isSystem ? (
                          <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-mono text-indigo-700">
                            {ev.agentIdentityCommitment}
                          </span>
                        ) : (
                          <Link
                            href={`/profiles/${ev.agentIdentityCommitment}`}
                            className="font-mono text-xs text-slate-700 hover:text-indigo-600 hover:underline"
                            title={ev.agentIdentityCommitment}
                          >
                            {ev.agentIdentityCommitment.slice(0, 10)}…
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {eventTypeBadge(ev.normalizedEventType)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                        {ev.sourceType}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {ev.validationSignalPresent ? (
                          <span className="text-emerald-700 font-medium">✓ Attested</span>
                        ) : (
                          <span className="text-slate-400">Observational</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(ev.observedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/trace/${ev.id}`}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          Inspect Trace →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
