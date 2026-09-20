import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ProfileCard } from "@/app/profiles/ProfileCard";
import {
  getAgentProfile,
  isValidAgentCommitmentHash,
} from "@/lib/public-portal/portal-service";
import { mapAgentProfileToViewModel } from "@/lib/public-portal/profile-view-model";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hash: string }>;
}): Promise<Metadata> {
  const { hash } = await params;
  const profile = isValidAgentCommitmentHash(hash)
    ? await getAgentProfile(hash)
    : null;
  const evidenceCount = profile?.totals.evidence_count ?? 0;
  const title = profile
    ? `Agent ${hash.slice(0, 8)}… — ${evidenceCount} evidence receipts`
    : "Agent profile — Passport";
  const canImage = isValidAgentCommitmentHash(hash)
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "https://passport.metis.gold"}/api/v1/badge/${hash}/attestation`
    : undefined;

  return {
    title,
    description:
      profile && evidenceCount > 0
        ? `${evidenceCount} evidence records, ${profile.totals.artifact_count} artifacts. Verified via Passport.`
        : "Public agent profile on Passport.",
    openGraph: {
      title,
      description:
        profile && evidenceCount > 0
          ? `${evidenceCount} evidence records on Passport`
          : "Agent profile on Passport",
      type: "profile",
      ...(canImage ? { images: [canImage] } : {}),
    },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;

  if (hash === "command-brain") {
    redirect("/admin/brain");
  }
  if (hash === "scheduler") {
    redirect("/admin");
  }

  if (!isValidAgentCommitmentHash(hash)) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-center">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Passport
        </Link>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Agent Profile Not Found</h1>
          <p className="mt-3 text-sm text-slate-600">
            The identifier <code className="font-mono text-xs bg-slate-200 px-2 py-0.5 rounded">{hash}</code> is not a valid 64-character agent commitment hash.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              href="/leaderboard"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 transition"
            >
              View Evidence Leaderboard →
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const profile = await getAgentProfile(hash);
  if (!profile) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-center">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Passport
        </Link>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Agent Profile Not Found</h1>
          <p className="mt-3 text-sm text-slate-600">
            No public agent profile or active enrollment exists for commitment:{" "}
            <code className="font-mono text-xs bg-slate-200 px-2 py-0.5 rounded break-all">{hash}</code>
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              href="/leaderboard"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 transition"
            >
              View Evidence Leaderboard →
            </Link>
            <Link
              href={`/verify/${hash}`}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Check Verification Status →
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const view = mapAgentProfileToViewModel(profile);
  if (!view) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Agent profile</h1>
      <p className="mt-2 text-slate-600">
        Public footprint and signed presentation — verify photo hash independently.
      </p>

      <div className="mt-8">
        <ProfileCard view={view} />
      </div>
    </main>
  );
}
