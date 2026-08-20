"use client";

import { useState, useEffect, useCallback } from "react";

export default function AdminApiKeys() {
  const [keys, setKeys] = useState<{ id: string; keyHash: string; name: string | null; createdAt: string }[]>([]);
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchKeys = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`Failed to load keys (${res.status})`);
        return;
      }
      setKeys(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const createKey = async () => {
    setError("");
    setNewKey("");
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: keyName || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setNewKey(data.rawKey);
      setKeyName("");
      fetchKeys();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteKey = async (keyHash: string) => {
    if (!confirm("Delete this API key?")) return;
    setError("");
    try {
      const res = await fetch(`/api/admin/api-keys/${keyHash}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok && res.status !== 204) {
        setError(`HTTP ${res.status}`);
        return;
      }
      fetchKeys();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-6">
      {newKey && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <strong>New API key — copy it now, it won&apos;t be shown again:</strong>
          <pre className="mt-1 overflow-x-auto rounded bg-green-100 p-2 font-mono break-all">{newKey}</pre>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(newKey)}
            className="mt-2 rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 transition"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-lg border p-4 bg-white">
        <h2 className="mb-3 text-lg font-semibold">Create new API key</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name (optional, e.g. production-bot)"
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={createKey}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 transition"
          >
            Create key
          </button>
        </div>
      </div>

      <div className="rounded-lg border p-4 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Existing API keys ({keys.length})</h2>
          <button
            type="button"
            onClick={fetchKeys}
            className="text-xs text-indigo-600 hover:underline"
          >
            Refresh list
          </button>
        </div>

        {loading && keys.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">Loading API keys&hellip;</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No API keys found. Create your first key above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Key Hash</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b">
                    <td className="py-2.5 font-medium">{k.name || "Default Key"}</td>
                    <td className="py-2.5 font-mono text-xs text-slate-500 truncate max-w-[180px]">{k.keyHash}</td>
                    <td className="py-2.5 text-xs text-slate-500">{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => deleteKey(k.keyHash)}
                        className="text-red-600 hover:underline text-xs"
                      >
                        Delete
                      </button>
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
