/**
 * Agent-ownership authorization for value-moving routes.
 *
 * Some endpoints let an agent act on its own commitment (swap its ANGEL, fractionalize a batch
 * into its wallet). Without binding the commitment in the request body to the authenticated
 * caller, anyone who knows a public commitment could move that agent's funds. This guard makes
 * the binding explicit: a HOLDER key may only act on an Agent it owns; an ISSUER key may act on
 * any agent (delegated operations).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export type OwnershipResult =
  | { ok: true; operatorId: string; role: "ISSUER" | "HOLDER" }
  | { ok: false; status: number; error: string };

export async function authorizeAgentCommitment(
  request: NextRequest,
  commitment: string
): Promise<OwnershipResult> {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  // ISSUER (non-HOLDER) keys may operate on behalf of any agent.
  if (operator.apiKeyRole !== "HOLDER") {
    return { ok: true, operatorId: operator.id, role: "ISSUER" };
  }

  const owned = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: commitment },
    select: { id: true },
  });
  if (!owned) {
    return {
      ok: false,
      status: 403,
      error: "The authenticated operator does not own this agent commitment",
    };
  }
  return { ok: true, operatorId: operator.id, role: "HOLDER" };
}
