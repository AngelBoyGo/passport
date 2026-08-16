import Link from "next/link";

const controls = [
  ["Receipt signatures", "Ed25519 signatures cover a canonical SHA-256 content hash."],
  ["Identity commitments", "Agents enroll with a proof-based challenge response; public keys become subject commitments."],
  ["Domain privacy", "Domain history is represented with blinded commitments so a verifier does not learn the issuing domain by default."],
  ["Independent verification", "The public key and verification routine are exposed so a third party can verify without trusting the dashboard."],
];

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">← Passport</Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Security and verification</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Passport makes behavioral evidence inspectable. It does not claim that an agent is universally trustworthy or that cryptography can prevent bad work.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {controls.map(([title, description]) => (
          <section key={title} className="rounded-xl border p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
          </section>
        ))}
      </div>
      <section className="mt-10 rounded-xl border bg-slate-50 p-6">
        <h2 className="font-semibold">What “not unforgeable” means</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          A valid receipt proves that Passport signed the exact canonical payload and that the receipt has not expired or been revoked. It does not prove the underlying claim was true, prevent a compromised operator from signing bad data, or turn domain-scoped history into a universal trust score.
        </p>
      </section>
      <Link href="/public-key" className="mt-8 inline-block text-sm font-medium text-indigo-600 underline">
        Inspect the current public key →
      </Link>
    </main>
  );
}
