"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import { ADMIN_TABS, type AdminTabId } from "@/app/admin/config/tabs";

type DashboardData = {
  generatedAt: string;
  operator: { email?: string | null; tier: string; credits: number; accountStatus: string; stakeBalanceCents: number };
  metrics: { receipts: number; receiptsToday: number; issuedAgents: number; evidence: number; engagements: number; slashingEvents: number; slashedCents: number };
  health: { overall: string; components: { id: string; label: string; status: string; detail: string }[] };
  activity: { type: string; label: string; detail: string; at: string; href: string }[];
  copilotContext: unknown;
};

const number = new Intl.NumberFormat("en-US");

export function ExecutiveDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [tab, setTab] = useState<AdminTabId>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("tab");
      if (p && ADMIN_TABS.some((t) => t.id === p)) {
        return p as AdminTabId;
      }
    }
    return "command-center";
  });
  const [error, setError] = useState("");
  const [copilotMessage, setCopilotMessage] = useState("Ask about the current operating picture.");

  const selectTab = useCallback((id: AdminTabId) => {
    setTab(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  async function load() {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load command center (${response.status})`);
    setData(await response.json());
  }

  useEffect(() => {
    load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard")
    );
  }, []);

  const context = useMemo(() => JSON.stringify({ tab, data: data?.copilotContext }, null, 2), [tab, data]);

  async function prepareCopilot() {
    const response = await fetch("/api/admin/copilot/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: context,
    });
    setCopilotMessage(
      response.ok
        ? "Context snapshot prepared. Connect an LLM provider to enable conversational actions."
        : "Copilot context could not be prepared."
    );
  }

  if (error) {
    return (
      <Panel>
        <p className="text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => load().catch((reason) => setError(String(reason)))}
          className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
        >
          Retry
        </button>
      </Panel>
    );
  }

  if (!data) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">Loading command center...</div>;
  }

  const metrics = data.metrics;
  const currentTab = ADMIN_TABS.find((item) => item.id === tab);

  return (
    <div className="min-h-screen bg-[#080b12] text-slate-100">
      <div className="mx-auto flex max-w-[1500px] gap-6 px-4 py-5 lg:px-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Passport / Executive</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">Command Center</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Developer and CEO operating view for trust, receipts, and economic safety.
            </p>
            <nav className="mt-8 space-y-1.5" role="tablist">
              {ADMIN_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => selectTab(item.id)}
                  className={`w-full rounded-xl px-3 py-3 text-left transition ${
                    tab === item.id
                      ? "bg-indigo-600/20 text-white ring-1 ring-indigo-400 shadow-lg shadow-indigo-950/50"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className={`block text-[10px] font-semibold uppercase tracking-widest ${tab === item.id ? "text-indigo-200" : "text-indigo-400/80"}`}>
                    {item.eyebrow}
                  </span>
                  <span className="mt-0.5 block text-sm font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-400 leading-snug">{item.description}</span>
                </button>
              ))}
            </nav>
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-400">
              <p className="text-slate-500">Signed in as</p>
              <p className="mt-1 truncate font-medium text-slate-200">{data.operator.email ?? "operator"}</p>
              <div className="mt-3 flex flex-col gap-2">
                <Link href="/admin/webhooks" className="text-indigo-300 hover:text-white transition">
                  Webhooks →
                </Link>
                <Link href="/admin/change-password" className="text-indigo-300 hover:text-white transition">
                  Change Password →
                </Link>
                <Link href="/" className="text-slate-400 hover:text-white transition">
                  View public site →
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.assign("/login");
                  }}
                  className="mt-1 text-left text-red-400 hover:text-red-300 transition"
                >
                  Sign out ⎋
                </button>
              </div>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">{currentTab?.eyebrow}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{currentTab?.label}</h2>
              <p className="mt-1 text-sm text-slate-400">Live snapshot · {new Date(data.generatedAt).toLocaleTimeString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => load().catch((reason) => setError(String(reason)))}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 transition"
              >
                Refresh data
              </button>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.assign("/login");
                }}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 transition"
              >
                Sign out
              </button>
            </div>
          </header>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" role="tablist">
            {ADMIN_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => selectTab(item.id)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-medium transition ${
                  tab === item.id ? "bg-indigo-600 text-white ring-1 ring-indigo-400" : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          {tab === "command-center" && (
            <div className="space-y-6">
              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Receipts issued" value={number.format(metrics.receipts)} detail={`+${number.format(metrics.receiptsToday)} in 24h`} tone="indigo" href="/admin/receipts" />
                <Metric label="Issued passports" value={number.format(metrics.issuedAgents)} detail="Enrolled agents" tone="emerald" href="/leaderboard" />
                <Metric label="Evidence observed" value={number.format(metrics.evidence)} detail="Privacy-safe events" tone="sky" href="/leaderboard" />
                <Metric label="Health posture" value={data.health.overall} detail={`${data.health.components.filter((item) => item.status === "operational").length}/${data.health.components.length} components operational`} tone={data.health.overall === "operational" ? "emerald" : "amber"} href="?tab=reliability" />
              </div>
              <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                <Panel title="Operating posture" eyebrow="At a glance">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Posture label="Operator account" value={data.operator.accountStatus} detail={`${data.operator.tier} tier`} />
                    <Posture label="Credits available" value={number.format(data.operator.credits)} detail={`Stake $${(data.operator.stakeBalanceCents / 100).toFixed(2)}`} />
                    <Posture label="Marketplace engagements" value={number.format(metrics.engagements)} detail="Held, delivered, paid, or cancelled" />
                    <Posture label="Slashing exposure" value={`$${(metrics.slashedCents / 100).toFixed(2)}`} detail={`${metrics.slashingEvents} recorded events`} />
                  </div>
                </Panel>
                <Panel title="Executive Copilot" eyebrow="Context-aware">
                  <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/10 p-4">
                    <p className="text-sm leading-relaxed text-slate-300">{copilotMessage}</p>
                    <button
                      type="button"
                      onClick={prepareCopilot}
                      className="mt-4 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 transition"
                    >
                      Sync this view
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    No LLM provider is configured in Passport yet. Context capture is ready and mutation tools remain disabled until a provider and confirmation flow are enabled.
                  </p>
                </Panel>
              </div>
              <Panel title="Recent activity" eyebrow="Traceable">
                <div className="divide-y divide-white/10">
                  {data.activity.length === 0 ? (
                    <p className="py-8 text-sm text-slate-500">No activity has been recorded yet.</p>
                  ) : (
                    data.activity.map((item) => (
                      <Link href={item.href} key={`${item.type}-${item.at}-${item.detail}`} className="flex items-center justify-between gap-4 py-3 hover:bg-white/[0.03] transition">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-200">{item.label}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">{item.detail}</p>
                        </div>
                        <time className="shrink-0 text-xs text-slate-500">{new Date(item.at).toLocaleString()}</time>
                      </Link>
                    ))
                  )}
                </div>
              </Panel>
            </div>
          )}

          {tab === "trust-operations" && (
            <div className="space-y-6">
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Metric label="Issued passports" value={number.format(metrics.issuedAgents)} detail="Enrolled agents" tone="emerald" href="/leaderboard" />
                <Metric label="Evidence observed" value={number.format(metrics.evidence)} detail="Privacy-safe events" tone="sky" href="/leaderboard" />
                <Metric label="Receipts today" value={number.format(metrics.receiptsToday)} detail="Last 24 hours" tone="indigo" href="/admin/receipts" />
              </div>
              <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                <Panel title="Enrollment pipeline" eyebrow="Identity">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Posture label="Enrolled agents" value={number.format(metrics.issuedAgents)} detail="Active passports" />
                    <Posture label="Evidence events" value={number.format(metrics.evidence)} detail="Total ingested" />
                    <Posture label="Public key endpoint" value="Ed25519" detail="/api/v1/public-key" />
                    <Posture label="A2A Agent Card" value="v1.0 Discovery" detail="/.well-known/agent.json" />
                  </div>
                </Panel>
                <Panel title="Quick actions" eyebrow="Operations">
                  <div className="space-y-3">
                    <Link href="/enroll" className="block rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300 hover:bg-white/5 transition">
                      Enroll a new agent →
                    </Link>
                    <Link href="/docs/api-reference" className="block rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300 hover:bg-white/5 transition">
                      Ingest evidence via API →
                    </Link>
                    <Link href="/admin/webhooks" className="block rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300 hover:bg-white/5 transition">
                      Configure webhooks →
                    </Link>
                    <Link href="/docs/integrate" className="block rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300 hover:bg-white/5 transition">
                      Integration guide →
                    </Link>
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {tab === "economy" && (
            <div className="space-y-6">
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Metric label="Credits available" value={number.format(data.operator.credits)} detail={`${data.operator.tier} tier`} tone="indigo" href="/admin/api-keys" />
                <Metric label="Engagements" value={number.format(metrics.engagements)} detail="Active marketplace" tone="sky" href="/admin" />
                <Metric label="Slashing exposure" value={`$${(metrics.slashedCents / 100).toFixed(2)}`} detail={`${metrics.slashingEvents} events`} tone="amber" href="/admin" />
              </div>
              <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                <Panel title="Account balance" eyebrow="Operator">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Posture label="Stake balance" value={`$${(data.operator.stakeBalanceCents / 100).toFixed(2)}`} detail="Minimum $50 escrow" />
                    <Posture label="Account status" value={data.operator.accountStatus} detail={data.operator.accountStatus === "ACTIVE" ? "All operations permitted" : "Blocked — escrow insolvent"} />
                    <Posture label="Current tier" value={data.operator.tier} detail="Stripe managed" />
                    <Posture label="Slashing events" value={String(metrics.slashingEvents)} detail={`Total: $${(metrics.slashedCents / 100).toFixed(2)}`} />
                  </div>
                </Panel>
                <Panel title="Engagement lifecycle" eyebrow="Marketplace">
                  <div className="space-y-2 text-sm text-slate-300">
                    <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
                      <span className="font-semibold text-indigo-300">1. HELD</span> — Hirer locks AngelCoin credits in escrow
                    </div>
                    <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
                      <span className="font-semibold text-emerald-300">2. DELIVERED</span> — Worker posts signed task deliverable evidence
                    </div>
                    <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
                      <span className="font-semibold text-sky-300">3. PAID</span> — Escrow unlocks and releases to worker
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Total engagements on record: {number.format(metrics.engagements)}</p>
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {tab === "reliability" && (
            <div className="space-y-6">
              <div className="mt-6 grid gap-3 sm:grid-cols-4">
                <Metric label="Health posture" value={data.health.overall} detail={data.health.overall === "operational" ? "All systems nominal" : "Some components degraded"} tone={data.health.overall === "operational" ? "emerald" : "amber"} href="?tab=reliability" />
                <Metric label="Receipts issued" value={number.format(metrics.receipts)} detail="All time" tone="indigo" href="/admin/receipts" />
                <Metric label="Evidence observed" value={number.format(metrics.evidence)} detail="Privacy-safe" tone="sky" href="/leaderboard" />
                <Metric label="Issued passports" value={number.format(metrics.issuedAgents)} detail="Enrolled agents" tone="emerald" href="/leaderboard" />
              </div>
              <Panel title="Reliability checkpoints" eyebrow="CTO">
                <div className="grid gap-3 md:grid-cols-2">
                  {data.health.components.map((component) => (
                    <div key={component.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-4">
                      <div>
                        <p className="text-sm font-medium text-slate-200">{component.label}</p>
                        <p className="mt-1 text-xs text-slate-400">{component.detail}</p>
                      </div>
                      <Status status={component.status} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Panel({ title, eyebrow, children }: { title?: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-2xl shadow-black/10">
      {title && (
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-300">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-medium text-white">{title}</h3>
        </div>
      )}
      {children}
    </section>
  );
}

function Metric({ label, value, detail, tone, href }: { label: string; value: string; detail: string; tone: string; href: string }) {
  const toneClass =
    { indigo: "bg-indigo-400", emerald: "bg-emerald-400", sky: "bg-sky-400", amber: "bg-amber-400" }[tone] ??
    "bg-slate-400";
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 transition hover:-translate-y-0.5 hover:border-indigo-400/40"
    >
      <div className={`h-2 w-2 rounded-full ${toneClass}`} />
      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold capitalize text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </Link>
  );
}

function Posture({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold capitalize text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function Status({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        status === "operational" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"
      }`}
    >
      {status}
    </span>
  );
}
