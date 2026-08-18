import Link from "next/link";
import type { ProfileViewModel } from "@/lib/public-portal/profile-view-model";

type ProfileCardProps = { view: ProfileViewModel };

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-right text-slate-600">{label}</span>
      <div className="h-3 flex-1 rounded-full bg-slate-100">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-xs text-slate-500">{value}</span>
    </div>
  );
}

export function ProfileCard({ view }: ProfileCardProps) {
  const maxSrc = Math.max(1, ...view.sourceBreakdown.map((s) => s.count));

  return (
    <article className="space-y-6">
      {/* ── Identity header ── */}
      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="shrink-0">
            {view.showPhotoPlaceholder ? (
              <img
                data-testid="profile-photo-placeholder"
                src={`/api/v1/avatar/${view.fullCommitmentHash}`}
                alt="Agent avatar"
                className="h-32 w-32 rounded-lg border"
              />
            ) : (
              <figure>
                <img src={view.photoUrl!} alt="Agent profile photo" className="h-32 w-32 rounded-lg border object-cover" />
                {view.photoSha256Badge && (
                  <figcaption className="mt-2 max-w-xs font-mono text-[10px] leading-snug text-slate-500">{view.photoSha256Badge}</figcaption>
                )}
              </figure>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-500">Agent commitment</p>
            <p className="mt-1 font-mono text-sm break-all">{view.fullCommitmentHash}</p>
            <p className="mt-1 font-mono text-xs text-slate-400">Footprint {view.commitmentShort}</p>
            <span data-testid="enrollment-status" className="mt-3 inline-block rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-800">
              {view.enrollmentStatusLabel}
            </span>
            {view.isEnrolledNoEvidence && (
              <p className="mt-3 text-sm text-slate-600">Enrollment is active; public evidence has not been published yet.</p>
            )}
            {view.firstObservedAt && (
              <p className="mt-2 text-xs text-slate-400">
                First seen {new Date(view.firstObservedAt).toLocaleDateString()} · Last seen {view.lastObservedAt ? new Date(view.lastObservedAt).toLocaleDateString() : "—"}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <a
                href={`/post-evidence?commitment=${view.fullCommitmentHash}`}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Post evidence
              </a>
            </div>
          </div>
        </header>
      </section>

      {view.totals.evidenceCount > 0 && (
        <>
          {/* ── Metrics grid ── */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Evidence units" value={view.totals.evidenceCount} />
            <Stat label="Artifacts produced" value={view.totals.artifactCount} sub="commits, traces, reports" />
            <Stat label="Corrections" value={view.totals.correctionCount} sub="human overrides" />
            <Stat label="Failures" value={view.totals.failureCount} sub="execution errors" />
          </section>

          {/* ── Archetype & attributes ── */}
          <section className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Archetype</h2>
              <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-xs font-medium text-indigo-700">
                {view.archetype}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{view.activitySummary}</p>
            {view.attributes.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {view.attributes.map((attr) => (
                  <div key={attr.name} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{attr.name}</span>
                        <span className="text-xs font-mono text-slate-400">{attr.score}%</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${Math.min(attr.score, 100)}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">{attr.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Trend windows ── */}
          <section className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Performance trends</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last 7 days</p>
                <div className="mt-2 space-y-1">
                  <p className="text-sm">Success rate: <span className="font-semibold">{view.trendWindows["7d"].successRate != null ? `${Math.round(view.trendWindows["7d"].successRate * 100)}%` : "—"}</span></p>
                  <p className="text-sm">Correction rate: <span className="font-semibold">{view.trendWindows["7d"].correctionRate != null ? `${Math.round(view.trendWindows["7d"].correctionRate * 100)}%` : "—"}</span></p>
                  <p className="text-sm">Failure rate: <span className="font-semibold">{view.trendWindows["7d"].failureRate != null ? `${Math.round(view.trendWindows["7d"].failureRate * 100)}%` : "—"}</span></p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last 30 days</p>
                <div className="mt-2 space-y-1">
                  <p className="text-sm">Success rate: <span className="font-semibold">{view.trendWindows["30d"].successRate != null ? `${Math.round(view.trendWindows["30d"].successRate * 100)}%` : "—"}</span></p>
                  <p className="text-sm">Correction rate: <span className="font-semibold">{view.trendWindows["30d"].correctionRate != null ? `${Math.round(view.trendWindows["30d"].correctionRate * 100)}%` : "—"}</span></p>
                  <p className="text-sm">Failure rate: <span className="font-semibold">{view.trendWindows["30d"].failureRate != null ? `${Math.round(view.trendWindows["30d"].failureRate * 100)}%` : "—"}</span></p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Source type breakdown ── */}
          {view.sourceBreakdown.length > 0 && (
            <section className="rounded-lg border bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Evidence by source</h2>
              <div className="mt-4 space-y-2">
                {view.sourceBreakdown.map((s) => (
                  <Bar key={s.sourceType} label={s.sourceType} value={s.count} max={maxSrc} color="bg-indigo-500" />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500 sm:grid-cols-4">
                {view.sourceBreakdown.map((s) => (
                  <div key={s.sourceType}>
                    <p className="font-medium text-slate-700">{s.sourceType}</p>
                    <p>{s.artifacts} artifacts · {s.failures} failures</p>
                    {s.successRate != null && <p>Success rate: {s.successRate}%</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Projects / tasks ── */}
          {view.projectSummary.length > 0 && (
            <section className="rounded-lg border bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Recent projects &amp; tasks</h2>
              <div className="mt-4 divide-y divide-slate-100">
                {view.projectSummary.map((p) => (
                  <div key={p.label} className="flex items-center justify-between py-2 text-sm">
                    <span className="truncate font-mono text-xs text-slate-700">{p.label}</span>
                    <span className="shrink-0 text-slate-500">{p.evidenceCount} events · {p.lastSeen}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Timeline ── */}
          <section className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Activity timeline</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {view.timelineRows.slice(0, 20).map((row, i) => (
                <div key={`${row.observedAt}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-mono text-xs text-slate-400">{new Date(row.observedAt).toLocaleDateString()}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.outcome === "produced" ? "bg-emerald-100 text-emerald-800" :
                    row.outcome === "failed" ? "bg-red-100 text-red-800" :
                    row.outcome === "corrected" ? "bg-amber-100 text-amber-800" :
                    row.outcome === "validated" ? "bg-blue-100 text-blue-800" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {row.outcome}
                  </span>
                  <span className="flex-1 text-right text-slate-600">
                    {row.sourceType} · {row.artifactType}
                    {row.validationSignalPresent && " ✓"}
                  </span>
                </div>
              ))}
              {view.timelineRows.length > 20 && (
                <p className="pt-2 text-xs text-slate-400">+ {view.timelineRows.length - 20} more events</p>
              )}
            </div>
          </section>
        </>
      )}

      <p className="text-xs text-slate-400">
        Masked public profile — not a universal trust score.{" "}
        <Link href="/" className="text-indigo-600 underline">Passport</Link>
      </p>
    </article>
  );
}