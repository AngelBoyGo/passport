"use client";

import { useState, useEffect, useCallback } from "react";

export default function AdminReceipts() {
  const [receipts, setReceipts] = useState<Record<string, unknown>[]>([]);
  const [filters, setFilters] = useState({ domain: "", status: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const search = useCallback(async () => {
    setError("");
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.domain) params.set("domain", filters.domain);
    if (filters.status) params.set("status", filters.status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);

    try {
      const res = await fetch(`/api/admin/receipts?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`Failed to load receipts (${res.status})`);
        return;
      }
      setReceipts(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    search();
  }, [search]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4 bg-white">
        <h2 className="mb-4 text-lg font-semibold">Filter receipts</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-slate-500">Domain</label>
            <input
              type="text"
              value={filters.domain}
              onChange={(e) => setFilters({ ...filters, domain: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              placeholder="CODE_GENERATION"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">Status</label>
            <input
              type="text"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              placeholder="success / pending"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">From date</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">To date</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={search}
          className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 transition"
        >
          Apply filters
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-lg border p-4 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Receipt ledger ({receipts.length})</h2>
          <button
            type="button"
            onClick={search}
            className="text-xs text-indigo-600 hover:underline"
          >
            Refresh
          </button>
        </div>

        {loading && receipts.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">Loading receipts&hellip;</p>
        ) : receipts.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No receipts found. Apply different filters or issue a new receipt.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-2 font-medium">Receipt ID</th>
                  <th className="pb-2 pr-2 font-medium">Status</th>
                  <th className="pb-2 pr-2 font-medium">Domain</th>
                  <th className="pb-2 pr-2 font-medium">Agent ID</th>
                  <th className="pb-2 font-medium">Issued At</th>
                  <th className="pb-2 font-medium">Verify Link</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={String(r.receiptId)} className="border-b">
                    <td className="py-2.5 pr-2 font-mono font-medium">{String(r.receiptId)}</td>
                    <td className="py-2.5 pr-2">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${
                        r.status === "success" ? "bg-emerald-100 text-emerald-800" :
                        r.status === "pending" ? "bg-amber-100 text-amber-800" :
                        "bg-red-100 text-red-800"
                      }`}>
                        {String(r.status)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2">{String(r.domain || "SYSTEM_INTEGRATION")}</td>
                    <td className="py-2.5 pr-2 font-mono">{String(r.agentId || "—")}</td>
                    <td className="py-2.5 pr-2 text-slate-500">{new Date(String(r.issuedAt)).toLocaleString()}</td>
                    <td className="py-2.5">
                      <a
                        href={`/verify/${String(r.receiptId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        Inspect →
                      </a>
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
