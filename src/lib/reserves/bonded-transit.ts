/**
 * Cross-Border Diplomatic Bonded Customs & Coastal Enclave Logistics Service
 *
 * Implements AES Protocol ASMC-3 Strategy #3 & Phase 2 Roadmap [M15-M18]:
 * - Secures physical export corridors from landlocked Mali, Burkina Faso, and Niger to coastal ports (Lomé, Togo & Conakry, Guinea).
 * - Diplomatic container e-seals instrumented with cryptographic tamper detection.
 * - Carrier performance bonding: economic performance bond locked at dispatch, refunded upon port arrival, 100% slashed on seal breach into the Sovereign Stabilization Fund.
 * - Coastal port clearing fee dividends: aligns coastal port authorities with the haven via programmatic fee sharing upon verified customs clearance.
 * - Continuous Proof-of-Reserves: Lots in state IN_TRANSIT and PORT_VAULTED under unbroken diplomatic seal remain valid reserve backing.
 */

import { prisma } from "@/lib/db";
import { getCommoditySpotPrices } from "./commodity-oracle";
import { generateLivePoR } from "./por-service";
import { verifyPinnedSignature, signaturesEnforced } from "@/lib/auth/verifyPinnedSignature";

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_CARRIER_BOND_ANGEL = 5000;

export interface DispatchTransitInput {
  waybillNumber: string;
  batchNumber: string;
  destinationPortCode: string; // "PORT-LOME-TG", "PORT-CONAKRY-GN"
  originVaultId: string;
  carrierCommitment: string;
  carrierBondAngel?: number;
  diplomaticSealDigest: string; // SHA-256 hex
}

export interface CheckpointInput {
  waybillNumber: string;
  checkpointName: string;
  inspectorSignature: string;
  inspectorPublicKey: string;
}

export interface PortArrivalInput {
  waybillNumber: string;
  portCode: string;
  enclaveSignature: string;
  enclavePublicKey?: string;
}

export interface SealBreachInput {
  waybillNumber: string;
  breachEvidence: string;
  reporterCommitment: string;
}

/**
 * Dispatches physical bullion convoy under diplomatic bonded seal and locks carrier bond.
 */
export async function dispatchDiplomaticTransit(input: DispatchTransitInput) {
  if (!COMMITMENT_RE.test(input.carrierCommitment)) {
    throw new Error("Invalid carrier commitment hash (expected 64-hex)");
  }
  if (!input.diplomaticSealDigest || !/^[0-9a-f]{64}$/i.test(input.diplomaticSealDigest)) {
    throw new Error("Invalid diplomatic seal digest (expected 64-hex SHA-256)");
  }

  const carrierBond = input.carrierBondAngel ?? DEFAULT_CARRIER_BOND_ANGEL;

  return prisma.$transaction(async (tx) => {
    // 1. Verify destination coastal port enclave
    const enclave = await tx.coastalPortEnclave.findUnique({
      where: { portCode: input.destinationPortCode },
    });
    if (!enclave) {
      throw new Error(`Coastal port enclave '${input.destinationPortCode}' not found`);
    }
    if (enclave.activeStatus !== "ACTIVE") {
      throw new Error(`Coastal port '${input.destinationPortCode}' is currently ${enclave.activeStatus}`);
    }

    // 2. Verify physical bullion batch
    const batch = await tx.vaultBatch.findUnique({
      where: { batchNumber: input.batchNumber },
    });
    if (!batch) {
      throw new Error(`Vault batch '${input.batchNumber}' not found`);
    }
    if (batch.status !== "AUDITED") {
      throw new Error(`Batch '${input.batchNumber}' must be in AUDITED state to dispatch (current: ${batch.status})`);
    }

    // 3. Verify and lock carrier performance bond
    const carrierWallet = await tx.agentWallet.findUnique({
      where: { subjectCommitment: input.carrierCommitment },
    });
    if (!carrierWallet) {
      throw new Error("Carrier wallet not found");
    }
    const available = carrierWallet.balance - carrierWallet.staked;
    if (available < carrierBond) {
      throw new Error(`Carrier has insufficient collateral for performance bond (${available} available < ${carrierBond} required)`);
    }

    // Lock carrier bond (increment staked)
    await tx.agentWallet.update({
      where: { subjectCommitment: input.carrierCommitment },
      data: {
        staked: { increment: carrierBond },
        lastActivityAt: new Date(),
      },
    });

    // 4. Update VaultBatch status to IN_TRANSIT
    await tx.vaultBatch.update({
      where: { batchNumber: input.batchNumber },
      data: { status: "IN_TRANSIT" },
    });

    // 5. Create BondedTransitWaybill
    return tx.bondedTransitWaybill.create({
      data: {
        waybillNumber: input.waybillNumber,
        batchNumber: input.batchNumber,
        enclaveId: enclave.id,
        destinationPortCode: input.destinationPortCode,
        originVaultId: input.originVaultId,
        carrierCommitment: input.carrierCommitment,
        carrierBondAngel: carrierBond,
        grossWeightGrams: batch.grossWeightGrams,
        fineGoldGrams: batch.fineWeightGrams,
        diplomaticSealDigest: input.diplomaticSealDigest,
        status: "DISPATCHED",
        checkpointsVisited: [],
      },
    });
  });
}

/**
 * Records verified intermediate customs inspection waypoint (e.g. Sikasso, Ouaga, Cinkassé).
 */
export async function recordIntermediateCheckpoint(input: CheckpointInput) {
  const waybill = await prisma.bondedTransitWaybill.findUnique({
    where: { waybillNumber: input.waybillNumber },
  });
  if (!waybill) {
    throw new Error(`Waybill '${input.waybillNumber}' not found`);
  }
  if (waybill.status !== "DISPATCHED" && waybill.status !== "IN_TRANSIT") {
    throw new Error(`Waybill is not active (current status: ${waybill.status})`);
  }
  if (waybill.checkpointsVisited.includes(input.checkpointName)) {
    throw new Error(`Checkpoint '${input.checkpointName}' was already visited for this waybill`);
  }

  // 1. Verify customs inspector Ed25519 signature over canonical waypoint payload,
  //    against the checkpoint's REGISTERED inspector key (never a caller-supplied key).
  const checkpoint = await prisma.customsCheckpoint.findFirst({
    where: { checkpointName: input.checkpointName, activeStatus: "ACTIVE" },
  });
  if (!checkpoint) {
    throw new Error(
      `Customs checkpoint '${input.checkpointName}' is not registered or inactive`
    );
  }
  const checkpointPayload = {
    checkpoint_name: input.checkpointName,
    diplomatic_seal_digest: waybill.diplomaticSealDigest,
    waybill_number: waybill.waybillNumber,
  };

  if (signaturesEnforced()) {
    const provenance = await verifyPinnedSignature({
      pinnedKey: checkpoint.inspectorPublicKey,
      providedKey: input.inspectorPublicKey,
      signatureHex: input.inspectorSignature,
      signPayload: checkpointPayload,
      context: "reserves.transit.checkpoint",
      commitment: input.checkpointName,
    });
    if (!provenance.valid) {
      throw new Error("Invalid checkpoint inspector signature");
    }
  }

  const updatedCheckpoints = [...waybill.checkpointsVisited, input.checkpointName];

  return prisma.bondedTransitWaybill.update({
    where: { waybillNumber: input.waybillNumber },
    data: {
      checkpointsVisited: updatedCheckpoints,
      status: "IN_TRANSIT",
    },
  });
}

/**
 * Confirms arrival at destination coastal port enclave, releases carrier bond, and credits port authority clearing fees.
 */
export async function recordPortArrival(input: PortArrivalInput) {
  const waybill = await prisma.bondedTransitWaybill.findUnique({
    where: { waybillNumber: input.waybillNumber },
    include: { enclave: true },
  });
  if (!waybill) {
    throw new Error(`Waybill '${input.waybillNumber}' not found`);
  }
  if (waybill.status !== "DISPATCHED" && waybill.status !== "IN_TRANSIT") {
    throw new Error(`Waybill cannot be arrived (current status: ${waybill.status})`);
  }
  if (input.portCode !== waybill.destinationPortCode) {
    throw new Error(
      `Port code mismatch: convoy arrived at '${input.portCode}' but was consigned to '${waybill.destinationPortCode}'`
    );
  }

  // 1. Verify Port Customs Authority Signature against the enclave's REGISTERED key.
  //    A caller-supplied enclavePublicKey must never override it (self-asserted signer bypass).
  const portKey = waybill.enclave.enclavePublicKey;
  if (!portKey) {
    throw new Error(`Enclave for port '${input.portCode}' has no registered public key`);
  }
  const arrivalPayload = {
    destination_port_code: input.portCode,
    diplomatic_seal_digest: waybill.diplomaticSealDigest,
    fine_gold_grams: waybill.fineGoldGrams,
    waybill_number: waybill.waybillNumber,
  };

  if (signaturesEnforced()) {
    const provenance = await verifyPinnedSignature({
      pinnedKey: portKey,
      providedKey: input.enclavePublicKey,
      signatureHex: input.enclaveSignature,
      signPayload: arrivalPayload,
      context: "reserves.transit.arrive",
      commitment: input.waybillNumber,
    });
    if (!provenance.valid) {
      throw new Error("Invalid coastal port enclave customs signature");
    }
  }

  // 2. Execute Arrival Settlement Transaction
  const spotPrices = getCommoditySpotPrices();
  const goldSpot = spotPrices.Au?.priceUsd ?? 75.0;
  // Port authority fee share = 0.50% (50 bps) of gold market value, in ANGEL
  const portFeeAngel = Math.max(
    1,
    Math.round((waybill.fineGoldGrams * goldSpot * (waybill.enclave.clearingFeeShareBps / 10000)) / 5.0)
  );

  return prisma.$transaction(async (tx) => {
    // 0. Atomic guard against concurrent arrival / double-refund
    const transitioned = await tx.bondedTransitWaybill.updateMany({
      where: {
        waybillNumber: input.waybillNumber,
        status: { in: ["DISPATCHED", "IN_TRANSIT"] },
      },
      data: {
        status: "PORT_ARRIVED",
        arrivedAt: new Date(),
      },
    });
    if (transitioned.count !== 1) {
      throw new Error(`Waybill '${input.waybillNumber}' is no longer active`);
    }

    // A. Unlock carrier performance bond
    await tx.agentWallet.update({
      where: { subjectCommitment: waybill.carrierCommitment },
      data: {
        staked: { decrement: waybill.carrierBondAngel },
        lastActivityAt: new Date(),
      },
    });

    // B. Credit coastal port enclave statistics
    await tx.coastalPortEnclave.update({
      where: { id: waybill.enclaveId },
      data: {
        totalTransitGrams: { increment: waybill.fineGoldGrams },
        totalFeesEarnedAngel: { increment: portFeeAngel },
      },
    });

    // C. Update VaultBatch status to PORT_VAULTED and update physical location to coastal port enclave
    await tx.vaultBatch.update({
      where: { batchNumber: waybill.batchNumber },
      data: {
        status: "PORT_VAULTED",
        vaultId: waybill.destinationPortCode,
        custodianName: waybill.enclave.portName,
        locationCity: waybill.enclave.portName,
        locationCountry: waybill.enclave.countryCode,
      },
    });

    // D. Finalize waybill
    return tx.bondedTransitWaybill.update({
      where: { waybillNumber: input.waybillNumber },
      data: {
        status: "PORT_ARRIVED",
        arrivedAt: new Date(),
      },
    });
  });
}

/**
 * Slashes 100% of carrier's performance bond and quarantines the batch upon tamper breach.
 */
export async function reportSealBreach(input: SealBreachInput) {
  const waybill = await prisma.bondedTransitWaybill.findUnique({
    where: { waybillNumber: input.waybillNumber },
  });
  if (!waybill) {
    throw new Error(`Waybill '${input.waybillNumber}' not found`);
  }
  if (waybill.status === "SEAL_BREACHED") {
    throw new Error(`Waybill '${input.waybillNumber}' has already been marked as breached`);
  }
  if (waybill.status === "PORT_ARRIVED" || waybill.status === "CLEARED") {
    throw new Error(`Cannot breach waybill '${input.waybillNumber}' in status '${waybill.status}'`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // 0. Atomic guard against concurrent double-slashing
    const transitioned = await tx.bondedTransitWaybill.updateMany({
      where: {
        waybillNumber: input.waybillNumber,
        status: { in: ["DISPATCHED", "IN_TRANSIT"] },
      },
      data: {
        status: "SEAL_BREACHED",
        slashedAt: new Date(),
      },
    });
    if (transitioned.count !== 1) {
      throw new Error(`Waybill '${input.waybillNumber}' is not active or already breached`);
    }

    // 1. Slash 100% of carrier's staked bond
    await tx.agentWallet.update({
      where: { subjectCommitment: waybill.carrierCommitment },
      data: {
        balance: { decrement: waybill.carrierBondAngel },
        staked: { decrement: waybill.carrierBondAngel },
        spentTotal: { increment: waybill.carrierBondAngel },
        lastActivityAt: new Date(),
      },
    });

    // Credit slashed bond into protocol stabilization fund (preserves token conservation)
    await tx.agentWallet.upsert({
      where: { subjectCommitment: "protocol_treasury_system" },
      create: {
        subjectCommitment: "protocol_treasury_system",
        balance: waybill.carrierBondAngel,
        earnedTotal: waybill.carrierBondAngel,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: waybill.carrierBondAngel },
        earnedTotal: { increment: waybill.carrierBondAngel },
        lastActivityAt: new Date(),
      },
    });

    // 2. Quarantine physical lot
    await tx.vaultBatch.update({
      where: { batchNumber: waybill.batchNumber },
      data: { status: "QUARANTINED" },
    });

    // 3. Mark waybill breached
    return tx.bondedTransitWaybill.update({
      where: { waybillNumber: input.waybillNumber },
      data: {
        status: "SEAL_BREACHED",
        slashedAt: new Date(),
      },
    });
  });

  // Re-compute live Proof-of-Reserves immediately (quarantined batch excluded)
  await generateLivePoR("GOLD").catch(() => null);

  return result;
}

/**
 * Lists coastal port enclaves and active transit waybills.
 */
export async function listTransitCorridors() {
  const [enclaves, waybills] = await Promise.all([
    prisma.coastalPortEnclave.findMany(),
    prisma.bondedTransitWaybill.findMany({
      take: 10,
      orderBy: { dispatchedAt: "desc" },
    }),
  ]);

  return {
    enclaves,
    recentWaybills: waybills,
  };
}

/**
 * Computes aggregate logistics metrics.
 */
export async function getTransitMetrics() {
  const [enclaves, waybills] = await Promise.all([
    prisma.coastalPortEnclave.findMany({ where: { activeStatus: "ACTIVE" } }),
    prisma.bondedTransitWaybill.findMany({
      select: { fineGoldGrams: true, status: true, carrierBondAngel: true },
    }),
  ]);

  const activeWaybills = waybills.filter(
    (w) => w.status === "DISPATCHED" || w.status === "IN_TRANSIT"
  );
  const transitFineGrams = activeWaybills.reduce((sum, w) => sum + w.fineGoldGrams, 0);
  const totalBondsLocked = activeWaybills.reduce((sum, w) => sum + w.carrierBondAngel, 0);
  const arrivedCount = waybills.filter((w) => w.status === "PORT_ARRIVED").length;
  const breachedCount = waybills.filter((w) => w.status === "SEAL_BREACHED").length;

  return {
    activeEnclavesCount: enclaves.length,
    activeWaybillsCount: activeWaybills.length,
    transitFineGoldGrams: Number(transitFineGrams.toFixed(3)),
    totalCarrierBondsLockedAngel: totalBondsLocked,
    totalConvoysArrived: arrivedCount,
    totalBreachesDetected: breachedCount,
  };
}
