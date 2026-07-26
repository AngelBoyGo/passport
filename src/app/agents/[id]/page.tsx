import { redirect } from "next/navigation";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";

/**
 * Legacy alias: /agents/:id → canonical /profiles/:hash.
 */
export default async function AgentProfileRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isValidAgentCommitmentHash(id)) {
    redirect("/");
  }

  redirect(`/profiles/${id.toLowerCase()}`);
}
