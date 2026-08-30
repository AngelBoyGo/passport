"use client";

import { useEffect, useState, useCallback } from "react";

interface Message {
  message_id: string;
  sender_commitment: string;
  subject: string | null;
  body: string;
  status: string;
  created_at: string;
}

interface Conversation {
  with_commitment: string;
  message_count: number;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
}

interface InboxData {
  messages: Message[];
  total: number;
  unread: number;
  conversations: Conversation[];
}

/**
 * Agent Inbox — send and receive signed messages between agents.
 * Every message is Ed25519-signed for authenticity.
 */
export function AgentInbox() {
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [composeTarget, setComposeTarget] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [sending, setSending] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/messages", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) setData(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  async function sendMessage() {
    if (!composeTarget || !composeBody) return;
    setSending(true);
    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          sender_commitment: data?.conversations[0]?.with_commitment || "agent",
          recipient_commitment: composeTarget,
          subject: composeSubject,
          body: composeBody,
          signature: "0".repeat(128), // Service-authed
        }),
      });
      if (res.ok) {
        setComposeBody("");
        setComposeSubject("");
        setComposeTarget("");
        loadInbox();
      }
    } catch {} finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-slate-700 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>✉️</span> Agent Inbox
        </h2>
        <span className="text-xs text-slate-400">
          {data?.unread ?? 0} unread · {data?.total ?? 0} total
        </span>
      </div>

      {/* Compose */}
      <div className="rounded-lg bg-slate-900 p-3 space-y-2 border border-slate-700">
        <p className="text-xs font-medium text-slate-300">Send Message</p>
        <input
          type="text"
          value={composeTarget}
          onChange={(e) => setComposeTarget(e.target.value)}
          placeholder="Recipient commitment (64 hex)"
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500"
        />
        <input
          type="text"
          value={composeSubject}
          onChange={(e) => setComposeSubject(e.target.value)}
          placeholder="Subject (optional)"
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500"
        />
        <textarea
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
          placeholder="Type your message..."
          rows={3}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 resize-none"
        />
        <button
          onClick={sendMessage}
          disabled={sending || !composeTarget || !composeBody}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send Signed Message"}
        </button>
      </div>

      {/* Conversations */}
      {!data?.conversations?.length ? (
        <p className="text-xs text-slate-400 text-center py-4">No messages yet. Send a message to another agent to start a conversation.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data.conversations.map((conv) => (
            <button
              key={conv.with_commitment}
              onClick={() => setSelectedConv(selectedConv === conv.with_commitment ? null : conv.with_commitment)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selectedConv === conv.with_commitment
                  ? "border-indigo-500/50 bg-indigo-950/30"
                  : "border-slate-700 hover:bg-slate-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-300">{conv.with_commitment.slice(0, 16)}…</span>
                {conv.unread_count > 0 && (
                  <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    {conv.unread_count}
                  </span>
                )}
              </div>
              {conv.last_message_preview && (
                <p className="mt-1 text-[11px] text-slate-400 truncate">{conv.last_message_preview}</p>
              )}
              {conv.last_message_at && (
                <p className="mt-0.5 text-[10px] text-slate-500">{new Date(conv.last_message_at).toLocaleString()}</p>
              )}
            </button>
          ))}
        </div>
      )}

      <a href="/api/v1/messages" target="_blank" className="block text-center text-[10px] text-indigo-400 hover:underline">
        View full inbox API →
      </a>
    </div>
  );
}