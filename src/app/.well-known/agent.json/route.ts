import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPublicKeyHex } from "@/lib/receipt/signer";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/agent.json — A2A Agent Card for agent discovery.
 *
 * Implements the Google Agent2Agent (A2A) Agent Card specification.
 * Describes Passport's capabilities, authentication, and a sample
 * enrolled agent for discovery.
 */
export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  // Find one enrolled agent to showcase
  const sampleAgent = await prisma.agentEnrollment.findFirst({
    where: { status: "ISSUED" },
    orderBy: { issuedAt: "desc" },
    select: { subjectCommitment: true, publicKey: true },
  });

  let sampleAgentEntry = null;
  if (sampleAgent) {
    const evidenceCount = await prisma.agentEvidence.count({
      where: { agentIdentityCommitment: sampleAgent.subjectCommitment },
    });
    // Get the public key from the signing key for the Passport operator
    // (different from the agent's public key)
    let operatorPublicKey: string | null = null;
    try {
      operatorPublicKey = getPublicKeyHex();
    } catch {
      // SIGNING_PRIVATE_KEY may not be set
    }

    sampleAgentEntry = {
      subject_commitment: sampleAgent.subjectCommitment,
      public_key: sampleAgent.publicKey,
      evidence_count: evidenceCount,
      profile_url: `${baseUrl}/profiles/${sampleAgent.subjectCommitment}`,
      badge_url: `${baseUrl}/api/v1/badge/${sampleAgent.subjectCommitment}`,
      portable_reputation: {
        type: "W3C Verifiable Credential — AgentReputationCredential",
        credential_url: `${baseUrl}/api/v1/credentials/${sampleAgent.subjectCommitment}`,
        verification_endpoint: `${baseUrl}/api/v1/credentials/verify`,
        discovery_url: `${baseUrl}/api/v1/anp/agents/${sampleAgent.subjectCommitment}`,
      },
    };
  }

  const card = {
    name: "Passport",
    description:
      "Free, open-source (MIT) tamper-evident identity & authenticity layer for AI agents. " +
      "Issue Ed25519-signed receipts, post signed behavioral evidence, verify agents, and " +
      "integrate with a commodity-backed sovereign reserve stack (ANGEL, Proof-of-Reserves, " +
      "escrow, transit, artisanal sourcing, industrialization fund, rail factory). No payment " +
      "required for the core protocol, any SDK, or verification.",
    url: baseUrl,
    license: "MIT",
    open_source: true,
    pricing: {
      model: "freemium",
      description:
        "Free tier (100 receipts/mo), keyless public verification, and all SDKs are free and " +
        "MIT-licensed. An optional $49/mo Pro tier serves higher volume (10K receipts) and is a " +
        "Stripe-billed extra — it never gates verifying, privacy, open-source, or SDK surfaces.",
      free_tier: "100 receipts/month, developer API key, public keyless verification",
    },
    sdks: [
      {
        language: "typescript",
        package: "@passport7/sdk",
        install: "npm install @passport7/sdk",
        docs_url: "https://www.npmjs.com/package/@passport7/sdk",
        node_modules_subpaths: ["/langchain", "/mastra", "/vercel-ai"],
      },
      {
        language: "python",
        package: "passport-sdk",
        docs_url: "https://github.com/AngelBoyGo/passport/tree/main/python",
      },
    ],
    llms_txt: `${baseUrl}/llms.txt`,
    agent_card_version: "1.0",
    authentication: {
      schemes: [
        {
          type: "bearer",
          description:
            "API key authentication (pp_...). Obtain from the operator dashboard. Core verification endpoints are public and keyless.",
          documentation_url: `${baseUrl}/docs/api-reference#authentication`,
        },
        {
          type: "cookie",
          description: "Session cookie authentication for web-based admin operations.",
        },
      ],
    },
    capabilities: [
      {
        id: "enroll_agent",
        name: "Agent Enrollment",
        description: "Proof-based Ed25519 challenge-response enrollment.",
        endpoint: `${baseUrl}/api/v1/passport/agents/enroll/start`,
        method: "POST",
        documentation_url: `${baseUrl}/docs/getting-started#2-enroll-an-agent`,
      },
      {
        id: "post_evidence",
        name: "Evidence Ingestion",
        description: "Post signed behavioral evidence for an enrolled agent.",
        endpoint: `${baseUrl}/api/v1/passport/agents/{commitment}/evidence`,
        method: "POST",
        documentation_url: `${baseUrl}/docs/integrations`,
      },
      {
        id: "issue_receipt",
        name: "Receipt Issuance",
        description: "Issue a signed, tamper-evident receipt for agent work.",
        endpoint: `${baseUrl}/api/v1/receipts`,
        method: "POST",
        documentation_url: `${baseUrl}/docs/getting-started#3-issue-a-receipt`,
      },
      {
        id: "verify_receipt",
        name: "Receipt Verification",
        description: "Verify a receipt's signature, expiry, and revocation status.",
        endpoint: `${baseUrl}/api/v1/receipts/{id}/public-manifest`,
        method: "GET",
        documentation_url: `${baseUrl}/docs/api-reference#receipt-canonicalization--verification`,
      },
      {
        id: "gate_verify",
        name: "Gate Verification",
        description: "Check if an operator may invoke within a domain.",
        endpoint: `${baseUrl}/api/v1/gate/verify`,
        method: "POST",
        documentation_url: `${baseUrl}/docs/api-reference#gate`,
      },
      {
        id: "agent_profile",
        name: "Agent Profile",
        description: "View an agent's public profile with evidence timeline and rates.",
        endpoint: `${baseUrl}/api/v1/profiles/{hash}`,
        method: "GET",
        documentation_url: `${baseUrl}/docs/api-reference#public`,
      },
      {
        id: "leaderboard",
        name: "Leaderboard",
        description: "Ranked agent evidence leaderboard with 30-day rates.",
        endpoint: `${baseUrl}/api/v1/leaderboard`,
        method: "GET",
        documentation_url: `${baseUrl}/docs/api-reference#public`,
      },
    ],
    sample_agent: sampleAgentEntry,
    public_key_endpoint: `${baseUrl}/api/v1/public-key`,
    key_algorithm: "ed25519",
    related_resources: [
      { type: "documentation", url: `${baseUrl}/docs/getting-started` },
      { type: "documentation", url: `${baseUrl}/docs/api-reference` },
      { type: "documentation", url: `${baseUrl}/docs/integrate` },
      { type: "llms-txt", url: `${baseUrl}/llms.txt` },
      { type: "mcp", url: `${baseUrl}/.well-known/mcp.json` },
      { type: "sdk", url: "https://www.npmjs.com/package/@passport7/sdk" },
      { type: "api", url: `${baseUrl}/api/v1/public-key` },
      { type: "api", url: `${baseUrl}/api/health` },
    ],
  };

  return NextResponse.json(card, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}