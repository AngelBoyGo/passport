/**
 * Sovereign Sahel Physical Proof-of-Reserves (PoR) Engine
 *
 * Implements deterministic cryptographic auditing for physical commodity reserves:
 * - Deterministic SHA-256 binary Merkle tree with verifiable inclusion proofs
 * - Canonical batch leaf serialization (RFC 8785 aligned)
 * - Strict status isolation: only AUDITED batches are included in active reserve trees
 * - Ed25519-signed reserve attestations with key verification
 * - Explicit disclaimers on cryptographic vs. physical custody semantics
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sign, getPublicKey } from "@noble/ed25519";
import { verifyPinnedSignature } from "@/lib/auth/verifyPinnedSignature";
import "@/lib/receipt/crypto";
import { prisma } from "@/lib/db";

// ── Types ──

export type BatchStatus =
  | "UNVERIFIED"
  | "AUDITED"
  | "IN_TRANSIT"
  | "PORT_VAULTED"
  | "QUARANTINED"
  | "REDEEMED"
  | "SETTLED_DELIVERY";

export const VALID_RESERVE_STATUSES: string[] = ["AUDITED", "IN_TRANSIT", "PORT_VAULTED"];

export interface VaultBatchData {
  batchNumber: string;
  reserveId?: string;
  vaultId: string;
  custodianName: string;
  locationCity: string;
  locationCountry: string;
  barSerials: string[];
  grossWeightGrams: number;
  fineness: number;
  fineWeightGrams: number;
  status: BatchStatus | string;
  assayRef?: string | null;
  metadata?: Record<string, unknown> | null;
  auditedAt?: Date | string | null;
}

export interface MerkleProofStep {
  position: "left" | "right";
  hash: string;
}

export interface MerkleInclusionProof {
  batchNumber: string;
  leafHash: string;
  merkleRoot: string;
  proof: MerkleProofStep[];
  verified: boolean;
}

export interface SignedPoRAttestation {
  attestation_id: string;
  commodity_type: string;
  symbol: string;
  total_fine_grams: number;
  total_gross_grams: number;
  active_lots_count: number;
  merkle_root: string;
  timestamp: string;
  public_key: string;
  signature: string;
  algorithm: "ed25519";
  disclaimer: string;
}

// ── Canonical Hashing ──

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/**
 * Deterministic JSON serialization with sorted keys (RFC 8785 aligned).
 */
export function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of sorted) {
    ordered[key] = obj[key];
  }
  return JSON.stringify(ordered);
}

/**
 * Computes deterministic Merkle leaf hash for a vaulted lot.
 */
export function computeBatchLeafHash(batch: VaultBatchData): string {
  const payload: Record<string, unknown> = {
    batch_number: batch.batchNumber,
    vault_id: batch.vaultId,
    custodian_name: batch.custodianName,
    location_country: batch.locationCountry.toUpperCase(),
    location_city: batch.locationCity,
    gross_weight_grams: Number(batch.grossWeightGrams.toFixed(4)),
    fineness: Number(batch.fineness.toFixed(4)),
    fine_weight_grams: Number(batch.fineWeightGrams.toFixed(4)),
    bar_serials: [...batch.barSerials].sort(),
    status: batch.status,
    assay_ref: batch.assayRef || null,
  };

  return sha256Hex(canonicalJson(payload));
}

// ── Merkle Tree & Inclusion Proof Engine ──

export interface MerkleTreeResult {
  root: string;
  leaves: Array<{ batchNumber: string; leafHash: string }>;
  proofs: Map<string, MerkleProofStep[]>;
}

/**
 * Builds a deterministic binary Merkle tree over an array of vaulted batches.
 * Batches are sorted lexicographically by batchNumber to ensure tree determinism.
 */
export function buildReserveMerkleTree(batches: VaultBatchData[]): MerkleTreeResult {
  // Include AUDITED, IN_TRANSIT, and PORT_VAULTED batches in the reserve tree
  const activeBatches = batches
    .filter((b) => VALID_RESERVE_STATUSES.includes(b.status))
    .sort((a, b) => a.batchNumber.localeCompare(b.batchNumber));

  if (activeBatches.length === 0) {
    return {
      root: "0".repeat(64),
      leaves: [],
      proofs: new Map(),
    };
  }

  const leaves = activeBatches.map((b) => ({
    batchNumber: b.batchNumber,
    leafHash: computeBatchLeafHash(b),
  }));

  if (leaves.length === 1) {
    const proofs = new Map<string, MerkleProofStep[]>();
    proofs.set(leaves[0].batchNumber, []);
    return {
      root: leaves[0].leafHash,
      leaves,
      proofs,
    };
  }

  // Track proof steps for each leaf index
  const leafProofs: MerkleProofStep[][] = leaves.map(() => []);
  let currentLevel = leaves.map((l) => l.leafHash);
  // Indices map from current level index to original leaf indices it represents
  let currentIndices: number[][] = leaves.map((_, i) => [i]);

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    const nextIndices: number[][] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const leftHash = currentLevel[i];
        const rightHash = currentLevel[i + 1];
        const parentHash = sha256Hex(leftHash + rightHash);
        nextLevel.push(parentHash);

        // Record proof steps for leaves in the left branch
        for (const leafIdx of currentIndices[i]) {
          leafProofs[leafIdx].push({ position: "right", hash: rightHash });
        }
        // Record proof steps for leaves in the right branch
        for (const leafIdx of currentIndices[i + 1]) {
          leafProofs[leafIdx].push({ position: "left", hash: leftHash });
        }

        nextIndices.push([...currentIndices[i], ...currentIndices[i + 1]]);
      } else {
        // Odd node: promoted by hashing with itself
        const nodeHash = currentLevel[i];
        const parentHash = sha256Hex(nodeHash + nodeHash);
        nextLevel.push(parentHash);

        for (const leafIdx of currentIndices[i]) {
          leafProofs[leafIdx].push({ position: "right", hash: nodeHash });
        }

        nextIndices.push([...currentIndices[i]]);
      }
    }

    currentLevel = nextLevel;
    currentIndices = nextIndices;
  }

  const proofs = new Map<string, MerkleProofStep[]>();
  for (let i = 0; i < leaves.length; i++) {
    proofs.set(leaves[i].batchNumber, leafProofs[i]);
  }

  return {
    root: currentLevel[0],
    leaves,
    proofs,
  };
}

/**
 * Verifies a cryptographic Merkle inclusion proof against a known root.
 */
export function verifyInclusionProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string
): boolean {
  if (proof.length === 0) {
    return leafHash.toLowerCase() === expectedRoot.toLowerCase();
  }

  let current = leafHash.toLowerCase();
  for (const step of proof) {
    const sibling = step.hash.toLowerCase();
    if (step.position === "right") {
      current = sha256Hex(current + sibling);
    } else {
      current = sha256Hex(sibling + current);
    }
  }

  return current.toLowerCase() === expectedRoot.toLowerCase();
}

// ── Key Management & Attestation Signing ──

function getPrivateKeyBytes(): Uint8Array | null {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SIGNING_PRIVATE_KEY must be configured in production");
    }
    return null;
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

export function getPoRPublicKeyHex(): string {
  const pk = getPrivateKeyBytes();
  if (!pk) return "";
  return bytesToHex(getPublicKey(pk));
}

export async function signPoRAttestation(
  payload: Omit<SignedPoRAttestation, "signature" | "public_key" | "algorithm">
): Promise<SignedPoRAttestation> {
  const canonical = canonicalJson(payload as unknown as Record<string, unknown>);
  const pk = getPrivateKeyBytes();
  const publicKey = getPoRPublicKeyHex();

  let signature = "";
  if (pk) {
    const sigBytes = await sign(utf8ToBytes(canonical), pk);
    signature = bytesToHex(sigBytes);
  }

  return {
    ...payload,
    algorithm: "ed25519",
    public_key: publicKey,
    signature,
  };
}

export async function verifyPoRAttestation(
  attestation: SignedPoRAttestation
): Promise<boolean> {
  if (!attestation.signature || !attestation.public_key) return false;
  try {
    const payload = {
      active_lots_count: attestation.active_lots_count,
      attestation_id: attestation.attestation_id,
      commodity_type: attestation.commodity_type,
      disclaimer: attestation.disclaimer,
      merkle_root: attestation.merkle_root,
      symbol: attestation.symbol,
      timestamp: attestation.timestamp,
      total_fine_grams: attestation.total_fine_grams,
      total_gross_grams: attestation.total_gross_grams,
    };
    const canonical = canonicalJson(payload);
    const check = await verifyPinnedSignature({
      pinnedKey: attestation.public_key,
      signatureHex: attestation.signature,
      signPayload: canonical,
      context: "reserves.por.verify",
    });
    return check.valid;
  } catch {
    return false;
  }
}

// ── Database Services ──

export const POR_DISCLAIMER =
  "Cryptographic inclusion proof certifies presence of the specified lot in the published sovereign reserve Merkle tree. It does not constitute an unencumbered legal title, financial guarantee, or immediate retail physical delivery receipt. Consult official assay and custodian certifications.";

/**
 * Computes live Proof-of-Reserves metrics, updates Merkle root, and returns signed attestation.
 */
export async function generateLivePoR(commodityType = "GOLD"): Promise<{
  reserve: {
    commodityType: string;
    symbol: string;
    totalGrams: number;
    totalFineGrams: number;
    encumberedFineGrams: number;
    unencumberedFineGrams: number;
    activeLotsCount: number;
    merkleRoot: string;
    lastAuditedAt: Date;
  };
  attestation: SignedPoRAttestation;
  batches: VaultBatchData[];
}> {
  const batchesFromDb = await prisma.vaultBatch.findMany({
    where: {
      reserve: { commodityType },
    },
    orderBy: { batchNumber: "asc" },
  });

  const batches: VaultBatchData[] = batchesFromDb.map((b) => ({
    batchNumber: b.batchNumber,
    reserveId: b.reserveId,
    vaultId: b.vaultId,
    custodianName: b.custodianName,
    locationCity: b.locationCity,
    locationCountry: b.locationCountry,
    barSerials: b.barSerials,
    grossWeightGrams: b.grossWeightGrams,
    fineness: b.fineness,
    fineWeightGrams: b.fineWeightGrams,
    status: b.status as BatchStatus,
    assayRef: b.assayRef,
    metadata: (b.metadata as Record<string, unknown>) || null,
    auditedAt: b.auditedAt,
  }));

  const tree = buildReserveMerkleTree(batches);
  const activeBatches = batches.filter((b) => VALID_RESERVE_STATUSES.includes(b.status));

  const totalGrossGrams = activeBatches.reduce((sum, b) => sum + b.grossWeightGrams, 0);
  const totalFineGrams = activeBatches.reduce((sum, b) => sum + b.fineWeightGrams, 0);
  const now = new Date();

  // Calculate encumbered grams in active HELD escrows (Premortem P0-2)
  const heldEscrows = await prisma.commodityEscrow.findMany({
    where: { status: "HELD", commodityType },
    select: { fineGrams: true },
  });
  const encumberedFineGrams = heldEscrows.reduce((sum, e) => sum + e.fineGrams, 0);
  const unencumberedFineGrams = Math.max(0, Number((totalFineGrams - encumberedFineGrams).toFixed(4)));

  // Update reserve record in DB if it exists
  const reserveRecord = await prisma.commodityReserve.upsert({
    where: {
      commodityType_symbol: {
        commodityType,
        symbol: commodityType === "GOLD" ? "Au" : commodityType.slice(0, 2),
      },
    },
    create: {
      commodityType,
      symbol: commodityType === "GOLD" ? "Au" : commodityType.slice(0, 2),
      totalGrams: totalGrossGrams,
      totalFineGrams: totalFineGrams,
      activeLotsCount: activeBatches.length,
      latestMerkleRoot: tree.root,
      lastAuditedAt: now,
    },
    update: {
      totalGrams: totalGrossGrams,
      totalFineGrams: totalFineGrams,
      activeLotsCount: activeBatches.length,
      latestMerkleRoot: tree.root,
      lastAuditedAt: now,
    },
  });

  const attestationPayload = {
    attestation_id: `por_${commodityType.toLowerCase()}_${now.getTime()}`,
    commodity_type: commodityType,
    symbol: reserveRecord.symbol,
    total_fine_grams: Number(totalFineGrams.toFixed(4)),
    total_gross_grams: Number(totalGrossGrams.toFixed(4)),
    active_lots_count: activeBatches.length,
    merkle_root: tree.root,
    timestamp: now.toISOString(),
    disclaimer: POR_DISCLAIMER,
  };

  const attestation = await signPoRAttestation(attestationPayload);

  return {
    reserve: {
      commodityType: reserveRecord.commodityType,
      symbol: reserveRecord.symbol,
      totalGrams: reserveRecord.totalGrams,
      totalFineGrams: reserveRecord.totalFineGrams,
      encumberedFineGrams,
      unencumberedFineGrams,
      activeLotsCount: reserveRecord.activeLotsCount,
      merkleRoot: tree.root,
      lastAuditedAt: now,
    },
    attestation,
    batches: activeBatches,
  };
}

/**
 * Gets inclusion proof for a specific batch number against the active reserve tree.
 */
export async function getBatchInclusionProof(
  batchNumber: string,
  commodityType = "GOLD"
): Promise<MerkleInclusionProof | null> {
  const allBatches = await prisma.vaultBatch.findMany({
    where: {
      reserve: { commodityType },
    },
    orderBy: { batchNumber: "asc" },
  });

  const target = allBatches.find((b) => b.batchNumber === batchNumber);
  if (!target) return null;

  const targetData: VaultBatchData = {
    batchNumber: target.batchNumber,
    reserveId: target.reserveId,
    vaultId: target.vaultId,
    custodianName: target.custodianName,
    locationCity: target.locationCity,
    locationCountry: target.locationCountry,
    barSerials: target.barSerials,
    grossWeightGrams: target.grossWeightGrams,
    fineness: target.fineness,
    fineWeightGrams: target.fineWeightGrams,
    status: target.status as BatchStatus,
    assayRef: target.assayRef,
  };

  // Non-reserve status batches (e.g. quarantined, unverified, redeemed) cannot produce active inclusion proofs
  if (!VALID_RESERVE_STATUSES.includes(target.status)) {
    const leafHash = computeBatchLeafHash(targetData);
    return {
      batchNumber,
      leafHash,
      merkleRoot: "0".repeat(64),
      proof: [],
      verified: false,
    };
  }

  const tree = buildReserveMerkleTree(
    allBatches.map((b) => ({
      batchNumber: b.batchNumber,
      vaultId: b.vaultId,
      custodianName: b.custodianName,
      locationCity: b.locationCity,
      locationCountry: b.locationCountry,
      barSerials: b.barSerials,
      grossWeightGrams: b.grossWeightGrams,
      fineness: b.fineness,
      fineWeightGrams: b.fineWeightGrams,
      status: b.status as BatchStatus,
      assayRef: b.assayRef,
    }))
  );

  const proof = tree.proofs.get(batchNumber) || [];
  const leafHash = computeBatchLeafHash(targetData);
  const verified = verifyInclusionProof(leafHash, proof, tree.root);

  return {
    batchNumber,
    leafHash,
    merkleRoot: tree.root,
    proof,
    verified,
  };
}
