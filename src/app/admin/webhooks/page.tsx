"use client";

import { useState, useEffect, useCallback } from "react";

type Subscription = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  secret?: string;
};

const EVENT_LABELS: Record<string, string> = {
  evidence_anchored: "Evidence Anchored",
  enrollment_completed: "Enrollment Completed",
};

const EVENT_RAW: Record<string, string> = {
  evidence_anchored: "evidence.anchored",
  enrollment_completed: "enrollment.completed",
};

export default function AdminWebhooks() {
  const [apiKey, setApiKey] = useState("");
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>(["evidence_anchored"]);
  const [createdSecret, setCreatedSecret] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("passport_admin_key");
    if (stored) setApiKey(stored);
  }, []);

  const fetchSubs = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/webhooks", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        setError(res.status === 401 ? "Unauthorized — check your API key" : `HTTP ${res.status}`);
        setSubs([]);
        return;
      }
      setSubs(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const createSub = async () => {
    setError("");
    setCreatedSecret("");
    if (!newUrl.trim()) {
      setError("URL is required");
      return;
    }
    try {
      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: newUrl.trim(),
          events: newEvents.map((e) => EVENT_RAW[e] ?? e),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setCreatedSecret(data.secret);
      setNewUrl("");
      setNewEvents(["evidence_anchored"]);
      fetchSubs();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteSub = async (id: string) => {
    if (!confirm("Delete this webhook subscription?")) return;
    setError("");
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok && res.status !== 204) {
        setError(`HTTP ${res.status}`);
        return;
      }
      fetchSubs();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleEvent = (key: string) => {
    setNewEvents((prev) =>
      prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]
    );
  };

  return (
    <div className="space-y-6">
      {/* API Key */}
      <div className="rounded-lg border p-4">
        <label className="block text-sm font-medium text-slate-700">API Key</label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
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
            onClick={fetchSubs}
            disabled={!apiKey}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {createdSecret && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <strong>New webhook secret — copy it now, it won&apos;t be shown again:</strong>
          <pre className="mt-1 overflow-x-auto rounded bg-green-100 p-2 font-mono break-all">{createdSecret}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(createdSecret)}
            className="mt-2 rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      {/* Create */}
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Create webhook</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-600">URL</label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <p className="text-sm text-slate-600">Events</p>
            <div className="mt-1 flex flex-wrap gap-4">
              {Object.entries(EVENT_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newEvents.includes(key)}
                    onChange={() => toggleEvent(key)}
                    className="rounded border-slate-300"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={createSub}
            disabled={!newUrl.trim() || newEvents.length === 0}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">
          Webhooks {subs.length > 0 && `(${subs.length})`}
        </h2>
        {loading && subs.length === 0 ? (
          <p className="text-sm text-slate-500">Loading webhooks&hellip;</p>
        ) : subs.length === 0 ? (
          <p className="text-sm text-slate-500">No webhooks configured. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-2 font-medium">URL</th>
                  <th className="pb-2 pr-2 font-medium">Events</th>
                  <th className="pb-2 pr-2 font-medium">Active</th>
                  <th className="pb-2 pr-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((sub) => (
                  <tr key={sub.id} className="border-b">
                    <td className="py-2 pr-2 font-mono text-xs max-w-[200px] truncate" title={sub.url}>
                      {sub.url}
                    </td>
                    <td className="py-2 pr-2 text-xs">
                      {sub.events.map((e) => EVENT_LABELS[e] ?? e).join(", ")}
                    </td>
                    <td className="py-2 pr-2">{sub.active ? "✅" : "❌"}</td>
                    <td className="py-2 pr-2 text-xs text-slate-500">
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => deleteSub(sub.id)}
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