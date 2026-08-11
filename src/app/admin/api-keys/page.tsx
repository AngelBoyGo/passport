"use client";

import { useState, useEffect } from "react";

export default function AdminApiKeys() {
  const [apiKey, setApiKey] = useState("");
  const [keys, setKeys] = useState<{ id: string; name: string; createdAt: string }[]>([]);
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("passport_admin_key");
    if (stored) setApiKey(stored);
  }, []);

  const fetchKeys = async () => {
    setError("");
    try {
      const res = await fetch("/api/v1/operator/api-keys", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      setKeys(await res.json());
    } catch (e) { setError(String(e)); }
  };

  const createKey = async () => {
    setError("");
    setNewKey("");
    try {
      const res = await fetch("/api/v1/operator/api-keys", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName || undefined }),
      });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const data = await res.json();
      setNewKey(data.rawKey);
      setKeyName("");
      fetchKeys();
    } catch (e) { setError(String(e)); }
  };

  const deleteKey = async (keyHash: string) => {
    setError("");
    try {
      const res = await fetch(`/api/v1/operator/api-keys/${keyHash}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      fetchKeys();
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
          <button onClick={fetchKeys} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
            Load keys
          </button>
        </div>
      </div>

      {newKey && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <strong>New API key — copy it now, it won&apos;t be shown again:</strong>
          <pre className="mt-1 overflow-x-auto rounded bg-green-100 p-2 font-mono">{newKey}</pre>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Create new key</h2>
        <div className="flex gap-2">
          <input
            type="text" value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name (optional)"
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
          <button onClick={createKey} className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
            Create
          </button>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Existing keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-slate-500">No API keys found.</p>
        ) : (
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
                  <td className="py-2">{k.name || "-"}</td>
                  <td className="py-2 font-mono text-xs">{k.id}</td>
                  <td className="py-2">{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">
                    <button
                      onClick={() => deleteKey(k.id)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}