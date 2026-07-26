import Link from "next/link";
import type { ProfileViewModel } from "@/lib/public-portal/profile-view-model";

type ProfileCardProps = {
  view: ProfileViewModel;
};

/**
 * Renders a public agent profile card from a pre-mapped view model.
 */
export function ProfileCard({ view }: ProfileCardProps) {
  return (
    <article className="rounded-lg border bg-white p-6 shadow-sm">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="shrink-0">
          {view.showPhotoPlaceholder ? (
            <div
              data-testid="profile-photo-placeholder"
              className="flex h-32 w-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500"
            >
              No signed photo
            </div>
          ) : (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={view.photoUrl!}
                alt="Agent profile photo"
                className="h-32 w-32 rounded-lg border object-cover"
              />
              {view.photoSha256Badge && (
                <figcaption className="mt-2 max-w-xs font-mono text-[10px] leading-snug text-slate-500">
                  {view.photoSha256Badge}
                </figcaption>
              )}
            </figure>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">Agent commitment</p>
          <p className="mt-1 font-mono text-sm break-all">
            {view.fullCommitmentHash}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-400">
            Footprint {view.commitmentShort}
          </p>
          <p
            data-testid="enrollment-status"
            className="mt-4 inline-block rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-800"
          >
            {view.enrollmentStatusLabel}
          </p>
          {view.isEnrolledNoEvidence && (
            <p className="mt-3 text-sm text-slate-600">
              Enrollment is active; public evidence has not been published yet.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Evidence units</dt>
              <dd className="font-semibold">{view.totals.evidenceCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Artifacts</dt>
              <dd className="font-semibold">{view.totals.artifactCount}</dd>
            </div>
          </dl>
        </div>
      </header>

      {view.timelineRows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <ul className="mt-4 space-y-2">
            {view.timelineRows.map((row) => (
              <li
                key={`${row.observedAt}-${row.sourceType}-${row.artifactType}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs text-slate-500">
                  {row.observedAt}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">
                  {row.outcome}
                </span>
                <span className="text-slate-600">
                  {row.sourceType} · {row.artifactType}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-xs text-slate-400">
        Masked public profile — not a universal trust score.{" "}
        <Link href="/" className="text-indigo-600 underline">
          Passport
        </Link>
      </p>
    </article>
  );
}
