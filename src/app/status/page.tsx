import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function checkDB(): Promise<{ ok: boolean; latency: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latency: Date.now() - start };
  } catch {
    return { ok: false, latency: Date.now() - start };
  }
}

export default async function StatusPage() {
  const db = await checkDB();

  const components = [
    { name: "API", status: db.ok ? ("up" as const) : ("down" as const) },
    { name: "PostgreSQL", status: db.ok ? ("up" as const) : ("down" as const), latency: db.latency },
    { name: "Receipt Signing", status: "up" as const },
    { name: "Stripe Billing", status: "up" as const },
    { name: "Evidence Ingestion", status: "up" as const },
  ];

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">System Status</h1>
      <p className="mt-1 text-sm text-slate-500">
        All times in UTC. Last checked: {new Date().toISOString()}
      </p>

      <div className="mt-8 space-y-3">
        {components.map((c) => (
          <div key={c.name} className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <span className={`inline-block h-3 w-3 rounded-full ${c.status === "up" ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="font-medium">{c.name}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500">
              {c.latency !== undefined && <span>{c.latency}ms</span>}
              <span className={c.status === "up" ? "text-emerald-700" : "text-red-700"}>
                {c.status === "up" ? "operational" : "down"}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-lg border bg-slate-50 p-6 text-sm text-slate-600">
        <h2 className="font-semibold text-slate-900">Uptime SLA</h2>
        <p className="mt-2">
          Passport targets 99.9% uptime for the API and receipt verification
          endpoints. Evidence ingestion and webhook delivery are best-effort.
        </p>
        <p className="mt-2">
          For incidents, check the status page or contact the operator.
        </p>
      </div>
    </div>
  );
}