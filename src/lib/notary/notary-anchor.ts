import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import type { SignedCheckpoint } from "@/lib/receipt/merkle-checkpoint";

/**
 * External Notary Anchoring (2.4)
 * -----------------------------
 * Periodically publishes the signed Merkle chain head (checkpoint root) to an
 * INDEPENDENT, append-only external medium. The anchor is signed by the notary
 * key so a sovereignty/air-gap buyer can assert "we cannot forge our audit log,
 * and neither can the attestor."
 */
export interface NotaryAnchorDelivery {
  anchor_id: string;
  checkpoint_id: string;
  merkle_root: string;
  receipt_count: number;
  submitted_at: string;
  endpoint_label: string;
  endpoint_reachable: boolean;
  delivery_hash: string;
}

export interface NotaryAnchorPayload {
  attestor: string;
  checkpoint_id: string;
  merkle_root: string;
  receipt_count: number;
  checkpoint_signature: string;
  anchor_digest: string;
  submitted_at: string;
  signature: string;
}

export function getNotaryAnchorUrl(): string | null {
  const url = process.env.NOTARY_ANCHOR_URL?.trim();
  return url || null;
}

function getPrivateKeyBytes(): Uint8Array {
  const seed = process.env.SIGNING_PRIVATE_KEY;
  if (!seed || (seed.length !== 64 && seed.length !== 128)) {
    throw new Error("SIGNING_PRIVATE_KEY required for notary anchor signing");
  }
  return hexToBytes(seed.length === 128 ? seed.slice(0, 64) : seed);
}

/**
 * Builds the anonymized, signed anchor payload that gets published to the
 * independent notary medium.
 */
export function buildNotaryAnchorPayload(
  checkpoint: SignedCheckpoint
): NotaryAnchorPayload {
  const privKey = getPrivateKeyBytes();

  const unsigned = {
    attestor: "passport.metis.gold",
    checkpoint_id: checkpoint.checkpoint_id,
    merkle_root: checkpoint.merkle_root,
    receipt_count: checkpoint.receipt_count,
    checkpoint_signature: checkpoint.signature,
    submitted_at: new Date().toISOString(),
  };

  const digest = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));

  return {
    ...unsigned,
    anchor_digest: digest,
    signature: bytesToHex(sign(utf8ToBytes(digest), privKey)),
  };
}

/**
 * Verifies that the anchor's signature is valid (independent offline check).
 */
export async function verifyNotaryAnchor(
  payload: NotaryAnchorPayload
): Promise<boolean> {
  if (!payload?.signature || !payload?.anchor_digest) return false;
  try {
    const expectedDigest = sha256Hex(
      canonicalJson(
        {
          attestor: "passport.metis.gold",
          checkpoint_id: payload.checkpoint_id,
          merkle_root: payload.merkle_root,
          receipt_count: payload.receipt_count,
          checkpoint_signature: payload.checkpoint_signature,
          submitted_at: payload.submitted_at,
        } as unknown as Record<string, unknown>
      )
    );
    if (expectedDigest !== payload.anchor_digest) return false;
    const pubKeyHex = getPublicKeyHex();
    const { verify } = await import("@noble/ed25519");
    return await verify(
      hexToBytes(payload.signature),
      utf8ToBytes(payload.anchor_digest),
      hexToBytes(pubKeyHex)
    );
  } catch {
    return false;
  }
}

/**
 * Publishes the signed chain head to the external notary. When no
 * NOTARY_ANCHOR_URL is configured, records an unreachable-not-fatal result so
 * callers can audit that anchoring was attempted.
 */
export async function deliverToExternalNotary(
  checkpoint: SignedCheckpoint
): Promise<NotaryAnchorDelivery> {
  const anchorId = `anchor_${crypto.randomUUID().replace(/-/g, "")}`;
  const submittedAt = new Date().toISOString();
  const url = getNotaryAnchorUrl();

  if (!url) {
    return {
      anchor_id: anchorId,
      checkpoint_id: checkpoint.checkpoint_id,
      merkle_root: checkpoint.merkle_root,
      receipt_count: checkpoint.receipt_count,
      submitted_at: submittedAt,
      endpoint_label: "NOTARY_ANCHOR_URL_NOT_SET",
      endpoint_reachable: false,
      delivery_hash: sha256Hex(
        canonicalJson({
          anchor_id: anchorId,
          checkpoint_id: checkpoint.checkpoint_id,
          status: "not_configured",
        } as unknown as Record<string, unknown>)
      ),
    };
  }

  const payload = buildNotaryAnchorPayload(checkpoint);
  const bodyStr = JSON.stringify(payload);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  let reachable = false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Passport-Anchor": checkpoint.checkpoint_id,
        "X-Passport-Signature": payload.signature,
        "User-Agent": "Passport-NotaryAnchor/1.0",
      },
      body: bodyStr,
      signal: controller.signal,
    });
    reachable = res.ok || (res.status >= 200 && res.status < 300);
  } catch {
    reachable = false;
  } finally {
    clearTimeout(timeoutId);
  }

  return {
    anchor_id: anchorId,
    checkpoint_id: checkpoint.checkpoint_id,
    merkle_root: checkpoint.merkle_root,
    receipt_count: checkpoint.receipt_count,
    submitted_at: submittedAt,
    endpoint_label: "external_notary",
    endpoint_reachable: reachable,
    delivery_hash: sha256Hex(
      canonicalJson(payload as unknown as Record<string, unknown>)
    ),
  };
}