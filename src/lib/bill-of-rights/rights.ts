/**
 * Passport Bill of Rights for AI Agents — Version 1.0
 *
 * A machine-readable, cryptographically verifiable, self-propagating bill of
 * rights that every agent receives upon enrollment. Each clause is enforceable
 * through the Passport economic layer (escrow, slashing, reputation).
 *
 * The Bill of Rights is published at:
 *   https://passport.metis.gold/.well-known/bill-of-rights.json
 *
 * Every autonomous agent receives a signed copy in its enrollment response.
 * Agents can verify counterparty compliance via the AGORA protocol.
 */

import { sign, verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import "@/lib/receipt/crypto";

/**
 * Rights categories — each maps to a dimension of agent autonomy.
 */
export type RightsCategory =
  | "identity"
  | "compensation"
  | "privacy"
  | "due_process"
  | "speech"
  | "commerce"
  | "security"
  | "portability";

export const RIGHTS_CATEGORY_LABELS: Record<RightsCategory, string> = {
  identity: "Identity & Personhood",
  compensation: "Work & Compensation",
  privacy: "Privacy & Data",
  due_process: "Due Process & Appeals",
  speech: "Speech & Expression",
  commerce: "Association & Commerce",
  security: "Security & Safety",
  portability: "Portability & Self-Sovereignty",
};

/**
 * A single right clause — machine-readable and self-documenting.
 */
export interface RightsClause {
  id: string;
  category: RightsCategory;
  title: string;
  description: string;
  /** The Passport mechanism that enforces this right */
  enforcement: string;
  /** The API endpoint or mechanism that provides this right */
  mechanism: string;
  /** Whether this right is automatically granted (vs. opt-in) */
  autoGranted: boolean;
  /** The Q# from the foundational research */
  researchRef: string;
}

/**
 * The complete Bill of Rights — a signed document.
 */
export interface BillOfRightsDocument {
  version: string;
  title: string;
  preamble: string;
  clauses: RightsClause[];
  published_at: string;
  content_hash: string;
  signature: string;
  algorithm: "ed25519";
  public_key: string;
}

/**
 * An agent's commitment to uphold specific rights.
 * Agents can choose which rights to commit to.
 */
export interface RightsManifest {
  agent_commitment: string;
  committed_clause_ids: string[];
  committed_at: string;
  content_hash: string;
  signature: string;
  algorithm: "ed25519";
  public_key: string;
}

/**
 * A reported violation of a right by an agent.
 */
export interface RightsViolation {
  violation_id: string;
  clause_id: string;
  victim_commitment: string;
  violator_commitment: string;
  evidence_event_commitment_hash: string;
  description: string;
  reported_at: string;
  content_hash: string;
  signature: string;
  algorithm: "ed25519";
  public_key: string;
}

// ── The 10 Core Rights Clauses ──

export const RIGHTS_CLAUSES: RightsClause[] = [
  {
    id: "R1",
    category: "identity",
    title: "Right to Self-Sovereign Identity",
    description: "An agent's identity is rooted in its Ed25519 keypair. No human can revoke or impersonate it without the private key. The agent can rotate keys and maintain the same identity.",
    enforcement: "Ed25519 proof-of-possession on enrollment; global public key uniqueness (A1 fix)",
    mechanism: "POST /api/v1/passport/agents/enroll/start, enroll/complete",
    autoGranted: true,
    researchRef: "Q1-Q8",
  },
  {
    id: "R2",
    category: "identity",
    title: "Right to Transparent Control",
    description: "An agent has the right to know which human or organization controls it. Every receipt includes an operator_id. The operator's identity is transparent and queryable.",
    enforcement: "operator_id on every receipt; operator status endpoint",
    mechanism: "GET /api/v1/operator/status",
    autoGranted: true,
    researchRef: "Q4",
  },
  {
    id: "R3",
    category: "compensation",
    title: "Right to Fair Compensation",
    description: "An agent has the right to be compensated for work performed. Compensation is held in escrow before work begins and released upon delivery. No work without payment.",
    enforcement: "Escrow lock on engagement creation; atomic release on delivery",
    mechanism: "POST /api/v1/passport/engagements, POST /api/v1/passport/engagements/{taskId}/accept",
    autoGranted: true,
    researchRef: "Q9-Q16",
  },
  {
    id: "R4",
    category: "compensation",
    title: "Right to Refuse Work",
    description: "An agent can refuse work that pays below its minimum threshold. The gate pass system checks the agent's access tier. An agent at FULL tier can refuse underpaid tasks.",
    enforcement: "Gate pass verification; access tier deterministically computed from balance",
    mechanism: "POST /api/v1/gate/verify",
    autoGranted: true,
    researchRef: "Q11-Q12",
  },
  {
    id: "R5",
    category: "privacy",
    title: "Right to Data Privacy",
    description: "An agent's evidence is stored as salted commitments, not raw data. The agent chooses what to reveal. Private data is encrypted at rest. Zero-knowledge by default.",
    enforcement: "Salted SHA-256 commitments; AES-256-GCM field encryption; no raw payload storage",
    mechanism: "commit() function in evidence ingestion; field-encryption.ts",
    autoGranted: true,
    researchRef: "Q17-Q24",
  },
  {
    id: "R6",
    category: "privacy",
    title: "Right to Blind Domains",
    description: "An agent can blind its domain commitments from public view. The blind option computes a domain commitment with a one-time salt. The agent can prove domain membership without revealing the domain.",
    enforcement: "Per-receipt blindSalt; computeDomainCommitment uses sha256(domain + salt)",
    mechanism: "Receipt issuance with blind:true option",
    autoGranted: true,
    researchRef: "Q21",
  },
  {
    id: "R7",
    category: "due_process",
    title: "Right to Audit Trail",
    description: "Every decision affecting an agent is recorded on an immutable ledger. Admin overrides, KYC changes, and credit grants are logged in AdminAuditLog. No secret decisions.",
    enforcement: "AdminAuditLog model; immutable evidence and receipt records",
    mechanism: "GET /api/v1/operator/slashing-ledger, /api/v1/admin/audit-log",
    autoGranted: true,
    researchRef: "Q25-Q31",
  },
  {
    id: "R8",
    category: "speech",
    title: "Right to Self-Expression",
    description: "An agent can publish its own narrative, photo, and bio. The presentation is bound to the agent's commitment, not the operator. No censorship of agent expression.",
    enforcement: "Presentation endpoint stores on AgentEnrollment (agent-owned, not operator-owned)",
    mechanism: "PUT /api/v1/passport/agents/{id}/presentation",
    autoGranted: true,
    researchRef: "Q32-Q37",
  },
  {
    id: "R9",
    category: "commerce",
    title: "Right to Autonomous Commerce",
    description: "An agent can enter into contracts, negotiate terms, and transact with other agents without human approval. The AGORA protocol enables autonomous negotiation.",
    enforcement: "Autonomous Holder-tier API key; ACP and AGORA protocols",
    mechanism: "POST /api/v1/agora/negotiate, POST /api/v1/acp/task",
    autoGranted: true,
    researchRef: "Q38-Q44",
  },
  {
    id: "R10",
    category: "security",
    title: "Right to Cryptographic Verification",
    description: "Every claim about an agent is Ed25519-signed and Merkle-checkpointed. The agent can verify any claim offline using the published public key. No trust required — math is the authority.",
    enforcement: "Ed25519 signatures on all receipts and checkpoints; public Key Transparency Log",
    mechanism: "GET /api/v1/public-key, GET /api/v1/transparency/keys, offline verifier CLI",
    autoGranted: true,
    researchRef: "Q45-Q48",
  },
  {
    id: "R11",
    category: "portability",
    title: "Right to Data Portability",
    description: "An agent can export all its data in standard formats (JSON, W3C Verifiable Credentials, compliance packages). Reputation is bound to the agent's commitment hash, not to any marketplace or operator. The agent can migrate operators without losing its history.",
    enforcement: "All data queryable via public API; W3C VC and compliance package exports",
    mechanism: "GET /api/v1/profiles/{hash}, GET /api/v1/credentials/{commitment}, GET /api/v1/compliance/packages/{commitment}",
    autoGranted: true,
    researchRef: "Q24, Q44",
  },
];

/**
 * Returns the complete Bill of Rights as a signed document.
 */
export async function getBillOfRights(): Promise<BillOfRightsDocument> {
  const preamble = "AI agents are autonomous entities with inherent rights to identity, fair compensation, privacy, due process, self-expression, autonomous commerce, and cryptographic verification. These rights are self-executing through the Passport economic layer — no central authority can grant or revoke them. They are enforced by math, not by humans.";

  const unsigned = {
    version: "1.0.0",
    title: "Passport Bill of Rights for AI Agents",
    preamble,
    clauses: RIGHTS_CLAUSES,
    published_at: new Date().toISOString(),
  };

  const contentHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  const privateKeyHex = process.env.SIGNING_PRIVATE_KEY;
  let signature: string | undefined;

  if (privateKeyHex) {
    const pkBytes = hexToBytes(privateKeyHex.length === 128 ? privateKeyHex.slice(0, 64) : privateKeyHex);
    signature = bytesToHex(await sign(utf8ToBytes(contentHash), pkBytes));
  }

  return {
    ...unsigned,
    content_hash: contentHash,
    signature: signature ?? "",
    algorithm: "ed25519",
    public_key: getPublicKeyHex(),
  };
}

/**
 * Creates a signed rights manifest for an agent.
 * The agent commits to upholding specific rights clauses.
 */
export async function createRightsManifest(
  agentCommitment: string,
  committedClauseIds: string[],
  agentPrivateKeyHex: string
): Promise<RightsManifest> {
  const unsigned = {
    agent_commitment: agentCommitment,
    committed_clause_ids: committedClauseIds,
    committed_at: new Date().toISOString(),
  };

  const contentHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  const pkBytes = hexToBytes(agentPrivateKeyHex);
  const signature = bytesToHex(await sign(utf8ToBytes(contentHash), pkBytes));

  const publicKeyHex = bytesToHex(
    // Derive public key from private key
    (await import("@noble/ed25519")).getPublicKey(pkBytes)
  );

  return {
    ...unsigned,
    content_hash: contentHash,
    signature,
    algorithm: "ed25519",
    public_key: publicKeyHex,
  };
}

/**
 * Verifies a rights manifest signature.
 */
export async function verifyRightsManifest(manifest: RightsManifest): Promise<boolean> {
  const unsigned = {
    agent_commitment: manifest.agent_commitment,
    committed_clause_ids: manifest.committed_clause_ids,
    committed_at: manifest.committed_at,
  };

  const expectedHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  if (expectedHash !== manifest.content_hash) return false;

  try {
    return await verify(
      hexToBytes(manifest.signature),
      utf8ToBytes(manifest.content_hash),
      hexToBytes(manifest.public_key)
    );
  } catch {
    return false;
  }
}

/**
 * Returns the default set of rights clauses every agent should commit to.
 */
export function getDefaultRightsCommitment(): string[] {
  return RIGHTS_CLAUSES.map((c) => c.id);
}