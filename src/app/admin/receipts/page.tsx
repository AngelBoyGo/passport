"use client";

import { useState } from "react";

export default function AdminReceipts() {
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("passport_admin_key") || "";
    }
    return "";
  });
  const [receipts, setReceipts] = useState<Record<string, unknown>[]>([]);
  const [filters, setFilters] = useState({ domain: "", status: "", from: "", to: "" });
  const [error, setError] = useState("");

  const search = async () => {
    setError("");
    const params = new URLSearchParams();
    if (filters.domain) params.set("domain", filters.domain);
    if (filters.status) params.set("status", filters.status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    try {
      const res = await fetch(`/api/v1/receipts?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      setReceipts(await res.json());
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <label className="block text-sm font-medium text-slate-700">API Key</label>
        <div className="mt-1 flex gap-2">
          <input
            type="password" value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              localStorage.setItem("passport_admin_key", e.target.value);
            }}
            className="flex-1 rounded border px-3 py-2 text-sm" placeholder="pp_..."
          />
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Filters</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-slate-500">Domain</label>
            <input type="text" value={filters.domain} onChange={(e) => setFilters({ ...filters, domain: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="FINANCIAL_CLEARING" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">Status</label>
            <input type="text" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm" placeholder="success/pending" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1 text-sm" />
          </div>
        </div>
        <button onClick={search} className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          Search
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Results ({receipts.length})</h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-slate-500">No receipts found. Apply filters and search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-2 font-medium">ID</th>
                  <th className="pb-2 pr-2 font-medium">Status</th>
                  <th className="pb-2 pr-2 font-medium">Domain</th>
                  <th className="pb-2 pr-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Issued</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r: Record<string, unknown>) => (
                  <tr key={r.receiptId as string} className="border-b">
                    <td className="py-2 pr-2 font-mono">{String(r.receiptId).slice(0, 12)}...</td>
                    <td className="py-2 pr-2">{String(r.status)}</td>
                    <td className="py-2 pr-2">{String(r.domain || "-")}</td>
                    <td className="py-2 pr-2">{String(r.agentId || "-").slice(0, 12)}...</td>
                    <td className="py-2">{new Date(r.issuedAt as string).toLocaleDateString()}</td>
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