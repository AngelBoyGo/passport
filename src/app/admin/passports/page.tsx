"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface PassportAgent {
  id: string;
  subjectCommitment: string;
  publicKey: string;
  context: string;
  status: "ISSUED" | "PENDING" | "REVOKED";
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  photoUrl: string | null;
  evidenceCount: number;
}

interface PassportData {
  counts: {
    total: number;
    issued: number;
    pending: number;
    revoked: number;
  };
  passports: PassportAgent[];
}

export default function AdminPassportsPage() {
  const [data, setData] = useState<PassportData | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadPassports = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/admin/passports?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`Failed to load passports (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount/filters
    loadPassports();
  }, [loadPassports]);

  function statusBadge(status: string) {
    switch (status) {
      case "ISSUED":
        return <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-semibold">ISSUED</span>;
      case "PENDING":
        return <span className="rounded-full bg-yellow-100 text-yellow-800 px-2.5 py-0.5 text-xs font-semibold">PENDING</span>;
      case "REVOKED":
        return <span className="rounded-full bg-red-100 text-red-800 px-2.5 py-0.5 text-xs font-semibold">REVOKED</span>;
      default:
        return <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-0.5 text-xs font-semibold">{status}</span>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Issued Passports</h1>
          <p className="text-sm text-slate-500">
            Comprehensive directory of all enrolled AI agents, cryptographic identities, and evidence records.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/enroll"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
          >
            + Enroll New Agent
          </Link>
          <button
            onClick={loadPassports}
            className="rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Enrolled</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{data?.counts.total ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-400">All agent records</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-600">Active (Issued)</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{data?.counts.issued ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-400">Passports in good standing</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-yellow-600">Pending</p>
          <p className="mt-2 text-2xl font-bold text-yellow-700">{data?.counts.pending ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-400">Awaiting challenge verification</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-red-600">Revoked</p>
          <p className="mt-2 text-2xl font-bold text-red-700">{data?.counts.revoked ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-400">Revoked credentials</p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by commitment, public key, or context…"
            className="w-full sm:max-w-md rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="ISSUED">Active (ISSUED)</option>
            <option value="PENDING">Pending</option>
            <option value="REVOKED">Revoked</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Agents Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading agent passports…</div>
        ) : !data || data.passports.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-medium text-slate-800">No agent passports found</p>
            <p className="mt-1 text-sm text-slate-500">
              {search || statusFilter ? "Try adjusting your search filters." : "Enroll your first agent to see them listed here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm divide-y divide-slate-100">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Agent Footprint</th>
                  <th className="px-4 py-3">Context</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Evidence Events</th>
                  <th className="px-4 py-3">Issued Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.passports.map((agent) => (
                  <tr key={agent.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {agent.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={agent.photoUrl}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover border"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                            {agent.subjectCommitment.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <Link
                            href={`/profiles/${agent.subjectCommitment}`}
                            className="font-mono text-xs font-semibold text-indigo-600 hover:underline"
                            title={agent.subjectCommitment}
                          >
                            {agent.subjectCommitment.slice(0, 12)}…
                          </Link>
                          <span className="block font-mono text-[10px] text-slate-400 truncate max-w-[140px]" title={agent.publicKey}>
                            key: {agent.publicKey.slice(0, 10)}…
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {agent.context || "Standard Agent"}
                    </td>
                    <td className="px-4 py-3">
                      {statusBadge(agent.status)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      {agent.evidenceCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {agent.issuedAt ? new Date(agent.issuedAt).toLocaleDateString() : new Date(agent.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3 text-xs">
                        <Link
                          href={`/profiles/${agent.subjectCommitment}`}
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          Profile →
                        </Link>
                        <Link
                          href={`/verify/${agent.subjectCommitment}`}
                          className="font-medium text-emerald-600 hover:text-emerald-800"
                        >
                          Verify →
                        </Link>
                        <Link
                          href={`/admin/evidence?agent=${agent.subjectCommitment}`}
                          className="font-medium text-slate-500 hover:text-slate-700"
                        >
                          Evidence →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
