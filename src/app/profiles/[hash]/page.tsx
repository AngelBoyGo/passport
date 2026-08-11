import Link from "next/link";
import { notFound } from "next/navigation";
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
    },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;

  if (!isValidAgentCommitmentHash(hash)) {
    notFound();
  }

  const profile = await getAgentProfile(hash);
  if (!profile) {
    notFound();
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
