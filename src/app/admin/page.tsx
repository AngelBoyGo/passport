"use client";

import { useState, useEffect } from "react";

export default function AdminDashboard() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("passport_admin_key");
    if (stored) setApiKey(stored);
  }, []);

  const fetchStatus = async () => {
    setError("");
    setStatus(null);
    try {
      const res = await fetch("/api/v1/operator/status", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${await res.text()}`);
        return;
      }
      setStatus(await res.json());
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <label className="block text-sm font-medium text-slate-700">
          API Key
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              localStorage.setItem("passport_admin_key", e.target.value);
            }}
            className="flex-1 rounded border px-3 py-2 text-sm"
            placeholder="pp_..."
          />
          <button
            onClick={fetchStatus}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            Load dashboard
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {status && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-slate-500">Credits</p>
            <p className="text-2xl font-bold">{String(status.credits)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-slate-500">Tier</p>
            <p className="text-2xl font-bold capitalize">{String(status.tier)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-slate-500">Status</p>
            <p className="text-2xl font-bold">{String(status.accountStatus)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-slate-500">Stake Balance</p>
            <p className="text-2xl font-bold">
              ${(Number(status.stakeBalanceCents) / 100).toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-slate-500">API Keys</p>
            <p className="text-2xl font-bold">{String(status.apiKeyCount)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-slate-500">Receipts</p>
            <p className="text-2xl font-bold">{String(status.receiptCount)}</p>
          </div>
        </div>
      )}

      {!status && !error && (
        <p className="text-sm text-slate-500">
          Enter your API key and click &ldquo;Load dashboard&rdquo; to view your
          operator status.
        </p>
      )}
    </div>
  );
}