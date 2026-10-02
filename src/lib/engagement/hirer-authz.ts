import { prisma } from "@/lib/db";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export type AiOperator = { id: string; email?: string | null };

/**
 * Audit fix (C1): escrow creation must be participant-bound. The caller may
 * only lock escrow from a commitment it provably owns (an `Agent` row binding
 * its operatorId to the commitment), or act as an executive admin. Without
 * this, any valid API key could name an arbitrary enrolled victim as `hirer`,
 * locking — and via the deliver/accept chain, draining — that victim's ANGEL.
 *
 * Shared by the primary /passport/engagements route and the ACP/A2A adapters
 * so the gate can never drift between siblings again.
 */
export async function callerOwnsHirer(
  operator: AiOperator,
  hirerCommitment: string
): Promise<boolean> {
  if (isExecutiveAdmin(operator)) return true;
  if (!hirerCommitment) return false;
  const owned = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: hirerCommitment },
    select: { id: true },
  });
  return Boolean(owned);
}
