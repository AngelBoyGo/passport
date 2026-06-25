import { NextRequest, NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { listJournalEntries } from "@/lib/angelcoin/ledger-service";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;

/**
 * GET /api/v1/passport/agents/:id/credit-journal — append-only journal (newest first).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`angelcoin-journal:${ip}`);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: rate.retryAfterSec
          ? { "Retry-After": String(rate.retryAfterSec) }
          : undefined,
      }
    );
  }

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    return NextResponse.json(
      { error: "agent_commitment_hash must be a full 64-character hex string" },
      { status: 400 }
    );
  }

  const rawLimit = new URL(request.url).searchParams.get("limit");
  const limit = rawLimit ? Number(rawLimit) : DEFAULT_LIMIT;

  try {
    const { account, entries } = await listJournalEntries(
      id,
      Number.isFinite(limit) ? limit : DEFAULT_LIMIT
    );
    return NextResponse.json({
      subject_commitment: account.subjectCommitment,
      entries: entries.map((entry) => ({
        id: entry.id,
        entry_type: entry.entryType,
        amount: entry.amount,
        counterparty_commitment: entry.counterpartyCommitment,
        metadata: entry.metadata,
        created_at: entry.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
