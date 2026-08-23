import { NextRequest, NextResponse } from "next/server";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { loadAccountWithJournal } from "@/lib/angelcoin/ledger-service";
import { computeBalances } from "@/lib/angelcoin/balances";
import { buildLiveStatus } from "@/lib/angelcoin/projections";
import { evaluateAccessTier } from "@/lib/angelcoin/access-tiers";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * GET /api/v1/passport/agents/:commitment/governance
 * Composes the agent's live status, credit journal summary, and access-tier
 * evaluation into one scoped snapshot for the user dashboard — surfacing the
 * previously dashboard-orphaned credit/access/passport-live primitives.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`governance:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    return NextResponse.json({ error: "Invalid agent commitment hash" }, { status: 400, headers: CORS });
  }

  try {
    const account = await loadAccountWithJournal(id);
    if (!account) {
      return NextResponse.json(
        { error: "No AngelCoin account or journal found for this commitment" },
        { status: 404, headers: CORS }
      );
    }

    const balances = computeBalances(account.journal);
    const evaluation = evaluateAccessTier({
      availableBalance: balances.availableBalance,
      lockedBalance: balances.lockedBalance,
      creditState: account.creditState,
      adminOverrideTier: account.adminOverrideTier,
    });
    const live = buildLiveStatus(account);

    const journal = account.journal
      ? [...account.journal]
          .sort((a, b) => (b as { createdAt: Date }).createdAt.getTime() - (a as { createdAt: Date }).createdAt.getTime())
          .slice(0, 10)
          .map((entry) => ({
            id: entry.id,
            entry_type: entry.entryType,
            amount: entry.amount,
            counterparty_commitment: entry.counterpartyCommitment,
            metadata: entry.metadata,
            created_at: (entry as { createdAt: Date }).createdAt.toISOString(),
          }))
      : [];

    return NextResponse.json(
      {
        subject_commitment: id,
        wallet: {
          credits: balances.availableBalance,
          granted: balances.grantedBalance,
          earned: balances.earnedBalance,
          spent: balances.spentBalance,
          locked: balances.lockedBalance,
        },
        live_status: live,
        access_tier: evaluation.tier,
        access_override: account.adminOverrideTier ?? null,
        recent_journal: journal,
      },
      { headers: { "Cache-Control": "public, max-age=30", ...CORS } }
    );
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Governance lookup failed";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}