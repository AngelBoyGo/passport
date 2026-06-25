import {
  dbReceiptToPayload,
  getReceiptWithHistory,
} from "@/lib/receipt-service";
import { verifyReceipt } from "@/lib/receipt/verify";
import { validateChain } from "@/lib/receipt/chain";
import { operatorIdFromStripe } from "@/lib/operator";
import { TERMINAL_STATUSES } from "@/lib/receipt/types";
import { receiptVerifyDisplayFields, confirmBlindedDomainMatch } from "@/lib/receipt/verifyDisplay";
import Link from "next/link";
import { notFound } from "next/navigation";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-800",
    refusal: "bg-amber-100 text-amber-800",
    null: "bg-slate-100 text-slate-700",
    graceful_shutdown: "bg-blue-100 text-blue-800",
    timeout: "bg-orange-100 text-orange-800",
    failure_tombstone: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${colors[status] ?? "bg-gray-100"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const { id } = await params;
  const { domain: domainQuery } = await searchParams;
  const data = await getReceiptWithHistory(id);
  if (!data) notFound();

  const { receipt, history } = data;
  const payload = dbReceiptToPayload({
    ...receipt,
    operatorId: operatorIdFromStripe(receipt.operator.stripeCustomerId),
  });
  const verification = await verifyReceipt(payload);

  const historyPayloads = history.map((h) =>
    dbReceiptToPayload({
      ...h,
      operatorId: operatorIdFromStripe(receipt.operator.stripeCustomerId),
    })
  );
  const chainResult = validateChain(historyPayloads);
  const displayFields = receiptVerifyDisplayFields({
    domain: receipt.domain,
    domainCommitment: receipt.domainCommitment,
    blindSalt: receipt.blindSalt,
    errorTranche: receipt.errorTranche,
    status: receipt.status,
  });
  const domainMatchConfirmed =
    displayFields.blinded &&
    domainQuery &&
    receipt.blindSalt &&
    receipt.domainCommitment
      ? confirmBlindedDomainMatch(
          domainQuery,
          receipt.blindSalt,
          receipt.domainCommitment
        )
      : undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        ← Passport
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">
        Receipt verification
      </h1>
      <p className="mt-2 text-slate-600">
        Tamper-evident integrity check — not a universal trust score.
      </p>

      <div
        className={`mt-8 rounded-lg border p-6 ${verification.valid ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
      >
        <p className="font-semibold">
          {verification.valid ? "✓ Signature valid" : "✗ Verification failed"}
        </p>
        {verification.error && (
          <p className="mt-1 text-sm text-red-700">{verification.error}</p>
        )}
        <p className="mt-2 font-mono text-xs text-slate-500">{id}</p>
      </div>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold">Receipt details</h2>
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Status</dt>
            <dd>
              <StatusBadge status={receipt.status} />
            </dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Type</dt>
            <dd>{receipt.receiptType}</dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Operator</dt>
            <dd className="font-mono text-xs">
              {operatorIdFromStripe(receipt.operator.stripeCustomerId)}
            </dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Agent</dt>
            <dd className="font-mono text-xs">{receipt.agentId}</dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Authority scope</dt>
            <dd>{receipt.authorityScope}</dd>
          </div>
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Operational domain</dt>
            <dd>{displayFields.operationalDomain.replace(/_/g, " ")}</dd>
          </div>
          {displayFields.blinded && domainQuery !== undefined && (
            <div className="flex justify-between border-b pb-2">
              <dt className="text-slate-500">Domain match</dt>
              <dd
                className={
                  domainMatchConfirmed
                    ? "text-emerald-700"
                    : "text-red-700"
                }
              >
                {domainMatchConfirmed
                  ? "Domain match confirmed"
                  : "Domain does not match"}
              </dd>
            </div>
          )}
          {displayFields.errorTranche !== undefined && (
            <div className="flex justify-between border-b pb-2">
              <dt className="text-slate-500">Error tranche</dt>
              <dd>{displayFields.errorTranche.replace(/_/g, " ")}</dd>
            </div>
          )}
          <div className="flex justify-between border-b pb-2">
            <dt className="text-slate-500">Input digest</dt>
            <dd className="max-w-xs truncate font-mono text-xs">
              {receipt.inputDigest}
            </dd>
          </div>
          {receipt.outputHash && (
            <div className="flex justify-between border-b pb-2">
              <dt className="text-slate-500">Output hash</dt>
              <dd className="max-w-xs truncate font-mono text-xs">
                {receipt.outputHash}
              </dd>
            </div>
          )}
          {receipt.refusalReason && (
            <div className="flex justify-between border-b pb-2">
              <dt className="text-slate-500">Refusal reason (hash)</dt>
              <dd className="max-w-xs truncate font-mono text-xs">
                {receipt.refusalReason}
              </dd>
            </div>
          )}
          {receipt.terminalReason && (
            <div className="flex justify-between border-b pb-2">
              <dt className="text-slate-500">Terminal reason (hash)</dt>
              <dd className="max-w-xs truncate font-mono text-xs">
                {receipt.terminalReason}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {(receipt.status === "refusal" ||
        receipt.status === "null" ||
        TERMINAL_STATUSES.includes(receipt.status as typeof TERMINAL_STATUSES[number])) && (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Notable outcome</h2>
          <p className="mt-1 text-sm text-amber-800">
            {receipt.status === "refusal" || receipt.status === "null"
              ? "This agent issued a first-class refusal — null receipts are more informative than silence."
              : "Terminal state recorded — silence is never ambiguous."}
          </p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">
          Domain-scoped history ({receipt.authorityScope})
        </h2>
        <p className="text-sm text-slate-500">
          History within this operator + agent + domain — not a universal score.
        </p>
        {!chainResult.valid && (
          <p className="mt-2 text-sm text-orange-700">
            Chain gap detected at index {chainResult.gapAt}
          </p>
        )}
        <ul className="mt-4 space-y-2">
          {history.map((h) => (
            <li
              key={h.receiptId}
              className="flex items-center justify-between rounded border px-4 py-2 text-sm"
            >
              <Link
                href={`/verify/${h.receiptId}`}
                className="font-mono text-indigo-600 hover:underline"
              >
                {h.receiptId.slice(0, 20)}…
              </Link>
              <StatusBadge status={h.status} />
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 text-xs text-slate-400">
        Passport provides tamper-evident, verifiable integrity — not unforgeable
        honesty. Verify independently via{" "}
        <a href="/api/v1/public-key" className="underline">
          published public key
        </a>
        .
      </p>
    </main>
  );
}
