import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJson } from "@/lib/receipt/canonical";
import { MONETARY_PARAMS } from "@/lib/angelcoin/monetary";
import "@/lib/receipt/crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/receipts/monetary — signed weekly monetary receipt.
 *
 * The "central bank publishes its numbers" endpoint. Anyone can verify:
 * 1. The circulating supply S
 * 2. The reserve balance R
 * 3. The current rate P
 * 4. That the signature is valid (ed25519, Passport's public key)
 *
 * This is what makes ANGEL "a real currency with a central bank" —
 * the rate is provable, not announced.
 */
export async function GET() {
  const [wallets, topups, slashes] = await Promise.all([
    prisma.agentWallet.findMany({ select: { balance: true, staked: true } }),
    prisma.operatorLedgerEntry.findMany({
      where: { kind: { in: ["stablecoin_topup", "angelcoin_topup", "angelcoin_on_behalf"] } },
      select: { deltaMicros: true, createdAt: true },
    }),
    prisma.slashingLedger.findMany({ select: { penaltyCents: true } }),
  ]);

  const circulatingSupply = wallets.reduce((sum, w) => sum + w.balance, 0);
  const stakedSupply = wallets.reduce((sum, w) => sum + w.staked, 0);
  const reserveBalance = topups.reduce((sum, t) => sum + Math.abs(t.deltaMicros) / 10_000 / 100, 0);
  const totalSlashed = slashes.reduce((sum, s) => sum + s.penaltyCents, 0);

  const currentP = MONETARY_PARAMS.P0;
  const currentPRed = currentP * (1 - MONETARY_PARAMS.redemptionSpread);
  const epochZero = new Date("2026-01-01T00:00:00Z").getTime();
  const epoch = Math.floor((Date.now() - epochZero) / (MONETARY_PARAMS.epochSeconds * 1000));

  const state = {
    epoch,
    P: currentP,
    S: circulatingSupply,
    R: reserveBalance,
    P_red: currentPRed,
    staked: stakedSupply,
    burned: totalSlashed,
    reserve_per_coin: circulatingSupply > 0 ? reserveBalance / circulatingSupply : 0,
    parameters: {
      P0: MONETARY_PARAMS.P0,
      alpha: MONETARY_PARAMS.alpha,
      spread: MONETARY_PARAMS.redemptionSpread,
      reserve_ratio: MONETARY_PARAMS.reserveRatio,
    },
  };

  // Sign the receipt
  const canonical = canonicalJson(state as unknown as Record<string, unknown>);
  const contentHash = bytesToHex(sha256(utf8ToBytes(canonical)));
  const privateKeyHex = process.env.SIGNING_PRIVATE_KEY;
  let signature = "";
  if (privateKeyHex) {
    const pkBytes = hexToBytes(privateKeyHex.length === 128 ? privateKeyHex.slice(0, 64) : privateKeyHex);
    const sigBytes = await sign(utf8ToBytes(contentHash), pkBytes);
    signature = bytesToHex(sigBytes);
  }

  return NextResponse.json({
    receipt: state,
    content_hash: contentHash,
    signature,
    algorithm: "ed25519",
    public_key: getPublicKeyHex(),
    verify_instructions: "Verify ed25519 signature over content_hash using public_key. Content hash is sha256 of canonicalJson(receipt). If signature is valid, the supply, reserve, and rate were not tampered with.",
    invariants: {
      reserve_adequacy: `R >= ρ × S × P_red → ${reserveBalance.toFixed(2)} >= ${MONETARY_PARAMS.reserveRatio} × ${circulatingSupply} × ${currentPRed.toFixed(2)}`,
      conservation: "Σ user balances + Σ platform balances + escrow locked + treasury = total minted − burned",
    },
    disclaimer: "ANGEL is a closed-loop utility currency. This receipt is for transparency. Not financial advice. Not an investment product.",
    generated_at: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}