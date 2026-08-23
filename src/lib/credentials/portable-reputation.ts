import { sign, verify, getPublicKey } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getAgentProfile } from "@/lib/public-portal/portal-service";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { getKeyTransparencyLog } from "@/lib/transparency/key-log";
import { prisma } from "@/lib/db";

/**
 * C1 fix — resolve the issuer verifying key ONLY from Passport's published key
 * transparency log. Never from the credential (attacker-controlled). A
 * credential claiming to be issued by Passport must verify under a Passport
 * pinned key, or it fails.
 */
function resolvePinnedIssuerKey(issuer?: string, verificationMethod?: string): string {
  const log = getKeyTransparencyLog();
  const pinnedKeys = log.entries
    .filter((e) => e.status === "active" || e.status === "rotated")
    .map((e) => e.public_key.toLowerCase());

  // If the credential claims a Passport issuer DID, extract that key and ensure
  // it appears in the pinned transparency log. Otherwise reject.
  const claimed = issuer || verificationMethod || "";
  const claimedMatch = claimed.match(/did:key:z([0-9a-f]{64})/i);
  if (claimedMatch) {
    const claimedKey = claimedMatch[1].toLowerCase();
    if (pinnedKeys.includes(claimedKey)) return claimedKey;
    throw new Error("Issuer key is not in the Passport transparency log");
  }

  // No claimed issuer → only the active pinned key may verify.
  const active = log.entries.find((e) => e.status === "active");
  if (active) return active.public_key.toLowerCase();
  return getPublicKeyHex().toLowerCase();
}

export interface AgentVerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    agent_commitment_hash: string;
    archetype: string;
    activity_summary: string;
    totals: {
      evidence_count: number;
      artifact_count: number;
      correction_count: number;
      failure_count: number;
    };
    rolling_30d: {
      success_rate: number | null;
      correction_rate: number | null;
      failure_rate: number | null;
    };
    first_observed_at: string | null;
    last_observed_at: string | null;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
}

export interface CredentialVerificationResult {
  valid: boolean;
  issuer?: string;
  subject?: string;
  error?: string;
}

function getPrivateKeyBytes(): Uint8Array {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    throw new Error("SIGNING_PRIVATE_KEY must be a 32-byte (64 hex) or 64-byte (128 hex) string");
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

/**
 * Generates a signed W3C Verifiable Credential for an enrolled agent.
 * The credential is self-contained and independently verifiable by any gateway or marketplace.
 */
export async function generateAgentVerifiableCredential(
  commitment: string,
  origin: string = "https://passport.metis.gold"
): Promise<AgentVerifiableCredential | null> {
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { publicKey: true, status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return null;
  }

  const profile = await getAgentProfile(commitment);
  if (!profile) {
    return null;
  }

  const now = new Date();
  const issuanceDate = now.toISOString();
  const privKey = getPrivateKeyBytes();
  const issuerPublicKey = bytesToHex(getPublicKey(privKey));
  const agentDid = `did:key:z${enrollment.publicKey}`;
  const issuerDid = `did:key:z${issuerPublicKey}`;
  const credentialId = `urn:uuid:${crypto.randomUUID()}`;

  const unsignedCredential = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://passport.metis.gold/contexts/reputation-v1.json",
    ],
    id: credentialId,
    type: ["VerifiableCredential", "AgentReputationCredential"],
    issuer: issuerDid,
    issuanceDate,
    validFrom: issuanceDate,
    credentialSubject: {
      id: agentDid,
      agent_commitment_hash: commitment,
      archetype: profile.archetype,
      activity_summary: profile.activity_summary,
      totals: {
        evidence_count: profile.totals.evidence_count,
        artifact_count: profile.totals.artifact_count,
        correction_count: profile.totals.correction_count,
        failure_count: profile.totals.failure_count,
      },
      rolling_30d: {
        success_rate: profile.trend_windows["30d"]?.success_rate ?? null,
        correction_rate: profile.trend_windows["30d"]?.correction_rate ?? null,
        failure_rate: profile.trend_windows["30d"]?.failure_rate ?? null,
      },
      first_observed_at: profile.first_observed_at,
      last_observed_at: profile.last_observed_at,
    },
  };

  const canonicalHash = sha256Hex(canonicalJson(unsignedCredential as unknown as Record<string, unknown>));
  const signatureBytes = await sign(utf8ToBytes(canonicalHash), privKey);

  return {
    ...unsignedCredential,
    proof: {
      type: "Ed25519Signature2020",
      created: issuanceDate,
      verificationMethod: `${issuerDid}#${issuerPublicKey.slice(0, 16)}`,
      proofPurpose: "assertionMethod",
      proofValue: bytesToHex(signatureBytes),
    },
  };
}

/**
 * Validates a W3C AgentReputationCredential offline against the issuer's Ed25519 key.
 */
export async function verifyAgentVerifiableCredential(
  vc: AgentVerifiableCredential
): Promise<CredentialVerificationResult> {
  if (!vc || !vc.proof || !vc.proof.proofValue) {
    return { valid: false, error: "Missing cryptographic proof in credential" };
  }

  const { proof, ...unsigned } = vc;
  const canonicalHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));

  // SECURITY (C1): resolve the issuer key ONLY from Passport's pinned,
  // transparency-log-published key(s). Never accept a key embedded in the
  // credential itself — an attacker could self-sign and pass verification.
  let issuerPubKeyHex = "";
  try {
    issuerPubKeyHex = resolvePinnedIssuerKey(vc.issuer, vc.proof.verificationMethod);
  } catch {
    return { valid: false, error: "Unable to resolve a pinned Passport issuer key" };
  }

  try {
    const isValid = await verify(
      hexToBytes(proof.proofValue),
      utf8ToBytes(canonicalHash),
      hexToBytes(issuerPubKeyHex)
    );

    if (!isValid) {
      return { valid: false, error: "Invalid signature or tampered credential claims" };
    }

    return {
      valid: true,
      issuer: vc.issuer,
      subject: vc.credentialSubject.id,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}
