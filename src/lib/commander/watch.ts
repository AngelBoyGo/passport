/**
 * Commander fleet-watch — the Passport Commander's eyes on every earning system.
 *
 * Passport is the brain. It does not itself place calls, find locums, or run the
 * marketplace; those are separate services. This module probes each one over
 * HTTP and returns a single consolidated snapshot the Telegram Commander posts
 * to the owner, and the brain records as telemetry.
 *
 *   Callora    — the call-center (Twilio/OpenAI bridge, outreach)   CALLORA_BASE_URL
 *   Medora     — physician job-finder on Callora (apply/RTR)        (same host, /api/medical)
 *   Marketplace— separate repo: job ingest + fleet + escrow         MARKETPLACE_BASE_URL
 *   Passport   — this process: brain health, fleet, AngelCoin/Sahel (in-process)
 *
 * Every probe is best-effort and time-boxed: a subsystem that is down is
 * reported as `down`, never thrown. The Commander must keep reporting even when
 * a child system fails — that is the whole point of a watcher.
 */

export type SubsystemStatus = "up" | "degraded" | "down" | "unconfigured";

export type SubsystemReport = {
  name: "callora" | "medora" | "marketplace" | "passport";
  role: string;
  status: SubsystemStatus;
  detail: Record<string, unknown>;
  error?: string;
};

export type FleetWatchSnapshot = {
  at: string;
  overall: SubsystemStatus;
  subsystems: SubsystemReport[];
};

const PROBE_TIMEOUT_MS = 6000;

function base (env: string, fallback = ""): string {
  return (process.env[env] || fallback).replace(/\/$/, "");
}

async function getJson (url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    let body: unknown = null;
    try { body = await r.json(); } catch { body = null; }
    return { ok: r.ok, status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

function worst (statuses: SubsystemStatus[]): SubsystemStatus {
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  return "up";
}

/** Callora — the call-center. Health plus optional queue depth. */
export async function probeCallora(): Promise<SubsystemReport> {
  const url = base("CALLORA_BASE_URL", "https://call.metis.gold");
  const detail: Record<string, unknown> = { url };
  try {
    const h = await getJson(`${url}/api/health`);
    detail.health = h.body ?? h.status;
    if (!h.ok) return { name: "callora", role: "call-center", status: "down", detail, error: `http_${h.status}` };
    // Best-effort: the ops pipeline route tells us if calls/applies are moving.
    return { name: "callora", role: "call-center", status: "up", detail };
  } catch (e) {
    return { name: "callora", role: "call-center", status: "down", detail, error: msg(e) };
  }
}

/** Medora — the physician job-finder riding on Callora. Pipeline counts if a
 *  machine secret is available; otherwise just confirms the host is up. */
export async function probeMedora(): Promise<SubsystemReport> {
  const url = base("CALLORA_BASE_URL", "https://call.metis.gold");
  const detail: Record<string, unknown> = { url };
  const secret = process.env.CALLORA_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    // Without a secret we cannot read the pipeline; report unconfigured rather
    // than pretend. The call-center probe still covers host liveness.
    return { name: "medora", role: "physician-job-finder", status: "unconfigured", detail,
             error: "no_callora_cron_secret" };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    // The real Medora pipeline counts live on /api/medical/analytics?pipeline=1
    // (there is no /api/medical/pipeline/status route — asserting one existed
    // was a cross-env false assumption that pinned Medora to "degraded").
    const r = await fetch(`${url}/api/medical/analytics?pipeline=1`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "x-internal-cron": secret },
    }).catch(() => null);
    clearTimeout(t);
    if (r && r.ok) {
      detail.pipeline = await r.json().catch(() => null);
      return { name: "medora", role: "physician-job-finder", status: "up", detail };
    }
    return { name: "medora", role: "physician-job-finder", status: "degraded", detail,
             error: r ? `http_${r.status}` : "unreachable" };
  } catch (e) {
    return { name: "medora", role: "physician-job-finder", status: "degraded", detail, error: msg(e) };
  }
}

/** Marketplace — the separate AgentMarket repo (job ingest + fleet + escrow).
 *  Its health routes are `/api/livez` / `/api/readyz` / `/api/healthz` (not
 *  `/api/health`), so probe them in order and accept any 200. */
export async function probeMarketplace(): Promise<SubsystemReport> {
  const url = base("MARKETPLACE_BASE_URL");
  if (!url) {
    return { name: "marketplace", role: "job-ingest+fleet+escrow", status: "unconfigured", detail: {},
             error: "MARKETPLACE_BASE_URL not set" };
  }
  const detail: Record<string, unknown> = { url };
  try {
    let up = false;
    let lastErr = "";
    for (const path of ["/api/livez", "/api/readyz", "/api/healthz", "/api/health"]) {
      const h = await getJson(`${url}${path}`).catch((e) => ({ ok: false, status: 0, body: null, err: msg(e) }));
      if (h.ok) { up = true; detail.health = { path, status: h.status }; break; }
      lastErr = `${path}:${h.status}`;
    }
    if (!up) return { name: "marketplace", role: "job-ingest+fleet+escrow", status: "down", detail, error: lastErr };
    // Identity check + pipeline reads (best-effort).
    const manifest = await getJson(`${url}/.well-known/ai-service.json`).catch(() => null);
    if (manifest?.ok) detail.manifest = { brand: (manifest.body as { brand?: string } | null)?.brand ?? "unknown" };
    const bridge = await getJson(`${url}/api/passport/bridge-health`).catch(() => null);
    if (bridge?.ok) detail.bridge = bridge.body;
    const q = await getJson(`${url}/api/routing/queues?limit=1`).catch(() => null);
    if (q?.ok && q.body) detail.queues = q.body;
    return { name: "marketplace", role: "job-ingest+fleet+escrow", status: "up", detail };
  } catch (e) {
    return { name: "marketplace", role: "job-ingest+fleet+escrow", status: "down", detail, error: msg(e) };
  }
}

/** Passport itself — brain health + fleet via the in-process services. */
export async function probePassport(): Promise<SubsystemReport> {
  const detail: Record<string, unknown> = {};
  try {
    const { getFleetStatus } = await import("@/lib/fleet/fleet-service");
    const fleet = await getFleetStatus();
    detail.fleet = { total: fleet.total, cap: fleet.cap, halt: fleet.halt, by_status: fleet.byStatus };
    // Sahel (iii) — ANGEL reserve backing, the physical Proof-of-Reserves line.
    // ANGEL-only per owner decision; the $0.01 credits wallet is not tracked.
    try {
      const { prisma } = await import("@/lib/db");
      const reserve = await prisma.commodityReserve
        .findFirst({ select: { totalFineGrams: true, activeLotsCount: true, latestMerkleRoot: true } })
        .catch(() => null);
      if (reserve) {
        detail.reserves = {
          total_fine_grams: reserve.totalFineGrams,
          active_lots: reserve.activeLotsCount,
          merkle_root: reserve.latestMerkleRoot?.slice(0, 16) ?? null,
        };
      }
    } catch { /* reserves are best-effort */ }
    const status: SubsystemStatus = fleet.halt ? "degraded" : "up";
    return { name: "passport", role: "brain+commander", status, detail };
  } catch (e) {
    return { name: "passport", role: "brain+commander", status: "degraded", detail, error: msg(e) };
  }
}

export async function watchAll (): Promise<FleetWatchSnapshot> {
  const [callora, medora, marketplace, passport] = await Promise.all([
    probeCallora(),
    probeMedora(),
    probeMarketplace(),
    probePassport(),
  ]);
  const subsystems = [callora, medora, marketplace, passport];
  // "unconfigured" is neutral — it is not an outage, it is a not-yet-wired link.
  const judged: SubsystemStatus[] = subsystems.map((s) =>
    s.status === "unconfigured" ? "up" : s.status
  );
  return { at: new Date().toISOString(), overall: worst(judged), subsystems };
}

function msg (e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Render a Telegram digest (Markdown). */
export function renderFleetWatch (snap: FleetWatchSnapshot): string {
  const icon = (s: SubsystemStatus) =>
    s === "up" ? "🟢" : s === "degraded" ? "🟡" : s === "down" ? "🔴" : "⚪";
  const lines = [
    `*Fleet watch* — overall ${icon(snap.overall)} ${snap.overall}`,
    `_${new Date(snap.at).toUTCString()}_`,
    "",
  ];
  for (const s of snap.subsystems) {
    lines.push(`${icon(s.status)} *${s.name}* — ${s.role}: ${s.status}${s.error ? ` (${s.error})` : ""}`);
  }
  // Sahel reserve line (ANGEL-only): the physical Proof-of-Reserves backing.
  const passport = snap.subsystems.find((s) => s.name === "passport");
  const reserves = (passport?.detail as { reserves?: { total_fine_grams?: number; active_lots?: number } } | undefined)?.reserves;
  if (reserves) {
    const kg = ((reserves.total_fine_grams ?? 0) / 1000).toFixed(2);
    lines.push("", `*Sahel reserves (ANGEL backing)* — ${kg} kg gold, ${reserves.active_lots ?? 0} active lots`);
  }
  return lines.join("\n");
}

/** Render the marketplace-specific digest (/market) from a fresh probe. */
export async function renderMarketplace (): Promise<string> {
  const m = await probeMarketplace();
  const icon = m.status === "up" ? "🟢" : m.status === "degraded" ? "🟡" : m.status === "down" ? "🔴" : "⚪";
  const lines = [`*Marketplace (Metis)* — ${icon} ${m.status}`, `${m.role}`, ""];
  const d = m.detail as Record<string, unknown>;
  if (m.error) lines.push(`_${m.error}_`);
  if (d.health) lines.push(`health: ${JSON.stringify(d.health)}`);
  if (d.manifest) lines.push(`brand: ${(d.manifest as { brand?: string }).brand}`);
  const q = d.queues as { counts?: Record<string, number>; labelled_total?: number } | undefined;
  if (q?.counts) {
    lines.push(
      `routes — agent-only ${q.counts["agent-only"] ?? 0}, hybrid ${q.counts.hybrid ?? 0}, human-only ${q.counts["human-only"] ?? 0}`
    );
  }
  if (d.bridge) lines.push(`passport bridge: ${JSON.stringify(d.bridge).slice(0, 160)}`);
  return lines.join("\n");
}
