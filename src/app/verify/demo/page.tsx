import Link from "next/link";

export default function VerifyDemoPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">← Passport</Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Public verifier demo</h1>
      <p className="mt-2 text-slate-600">
        This sample shows the evidence a verifier should inspect before accepting an agent result.
      </p>
      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <p className="font-semibold text-emerald-900">✓ Signature valid</p>
        <p className="mt-2 text-sm text-emerald-800">The published Ed25519 key verifies the canonical receipt content.</p>
      </div>
      <section className="mt-8 rounded-lg border p-6">
        <h2 className="font-semibold">Sample receipt outcome</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between border-b pb-2"><dt className="text-slate-500">Status</dt><dd className="font-medium text-emerald-700">success</dd></div>
          <div className="flex justify-between border-b pb-2"><dt className="text-slate-500">Chain</dt><dd className="font-medium text-emerald-700">intact</dd></div>
          <div className="flex justify-between border-b pb-2"><dt className="text-slate-500">Domain</dt><dd className="font-mono text-xs">blinded commitment</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Revocation</dt><dd className="font-medium text-emerald-700">not revoked</dd></div>
        </dl>
      </section>
      <p className="mt-6 text-sm text-slate-500">This is a static sample artifact. Verify a real receipt by opening <code>/verify/&lt;receipt_id&gt;</code>.</p>
    </main>
  );
}
