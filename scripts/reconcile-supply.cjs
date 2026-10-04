/**
 * Supply-ledger reconciliation checker (READ-ONLY).
 *
 * Runbook tool for the supply unification (audit-4): compares the two money
 * ledgers per subject commitment and reports any drift, without writing.
 *
 *   Ledger A: AgentWallet.balance                      (the canonical supply counter)
 *   Ledger B: AngelCoin journal availableBalance       (grants+earned-spent-locked)
 *
 * A row only matters if BOTH sides are non-zero and differ (a wallet with
 * balance but no journal history is expected for wallets funded outsied the
 * journal, e.g. legacy grants; reported separately as "wallet-only").
 *
 * Usage:
 *   node scripts/reconcile-supply.cjs            # full report
 *   RECONCILE_LIMIT=200 node scripts/reconcile-supply.cjs
 * Exit codes: 0 = no drift, 1 = drift found, 2 = hard error.
 * NOTE: always read-only. It never writes.
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const limit = Number(process.env.RECONCILE_LIMIT) || 500;

  const wallets = await prisma.agentWallet.findMany({
    select: { subjectCommitment: true, balance: true, staked: true, earnedTotal: true, spentTotal: true },
    take: limit,
  });

  const accounts = await prisma.angelCoinAccount.findMany({
    select: { subjectCommitment: true, journal: { select: { entryType: true, amount: true } } },
  });
  const journalByCommitment = new Map(accounts.map((a) => [a.subjectCommitment, a.journal]));

  const { computeBalances } = (() => {
    // Local copy of the canonical reducer to avoid importing TS in a cjs script.
    const EARNED = new Set(["PEER_GIFT", "TASK_PAYMENT", "SAFETY_NET_TOPUP", "RECOVERY_AWARD"]);
    function computeBalances(entries) {
      let granted = 0, earned = 0, spent = 0, lock = 0, unlock = 0, adj = 0;
      for (const e of entries) {
        switch (e.entryType) {
          case "OPERATOR_GRANT": granted += e.amount; break;
          case "PEER_GIFT": case "TASK_PAYMENT": case "SAFETY_NET_TOPUP": case "RECOVERY_AWARD":
            if (EARNED.has(e.entryType)) earned += e.amount; break;
          case "SPEND": spent += e.amount; break;
          case "LOCK": lock += e.amount; break;
          case "UNLOCK": unlock += e.amount; break;
          case "ADJUSTMENT": adj += e.amount; break;
          default: break;
        }
      }
      const locked = Math.max(0, lock - unlock);
      return { availableBalance: granted + earned - spent - locked + adj };
    }
    return { computeBalances };
  })();

  const rows = [];
  let walletOnlyCount = 0;
  let journalOnlyCount = 0;
  let inSync = 0;

  for (const w of wallets) {
    const journal = journalByCommitment.get(w.subjectCommitment);
    const journalAvail = journal ? computeBalances(journal).availableBalance : null;
    if (journalAvail === null) {
      if (w.balance !== 0) { walletOnlyCount++; rows.push({ commit: w.subjectCommitment.slice(0, 16) + "…", wallet: w.balance, journal: "—", drift: "wallet-only" }); }
      else inSync++;
      continue;
    }
    if (journalAvail === w.balance) { inSync++; continue; }
    rows.push({ commit: w.subjectCommitment.slice(0, 16) + "…", wallet: w.balance, journal: journalAvail, drift: w.balance - journalAvail });
  }

  for (const a of accounts) {
    if (!wallets.some((w) => w.subjectCommitment === a.subjectCommitment)) {
      const avail = computeBalances(a.journal).availableBalance;
      if (avail !== 0) { journalOnlyCount++; rows.push({ commit: a.subjectCommitment.slice(0, 16) + "…", wallet: "(no wallet)", journal: avail, drift: "journal-only" }); }
    }
  }

  console.log("=".repeat(64));
  console.log("SUPPLY LEDGER RECONCILIATION (read-only)");
  console.log("=".repeat(64));
  console.log(`wallets scanned: ${wallets.length}  accounts scanned: ${accounts.length}`);
  console.log(`in sync: ${inSync}`);
  console.log(`wallet-only (no journal row): ${walletOnlyCount}`);
  console.log(`journal-only (no wallet row): ${journalOnlyCount}`);
  console.log(`drifting rows: ${rows.length}`);
  if (rows.length) {
    console.log("");
    console.log("commitment            | wallet     | journal    | drift");
    console.log("-".repeat(64));
    for (const r of rows.slice(0, 30)) {
      console.log(
        String(r.commit).padEnd(21) + " | " +
        String(r.wallet).padEnd(10) + " | " +
        String(r.journal).padEnd(10) + " | " + r.drift
      );
    }
    if (rows.length > 30) console.log(`… and ${rows.length - 30} more`);
  }
  const supplySum = wallets.reduce((s, w) => s + w.balance, 0);
  console.log("");
  console.log(`canonical supply (Σ wallet.balance): ${supplySum} ANGEL`);
  console.log(`AGENTS_MODE: exit=${rows.length ? 1 : 0} (drift=${rows.length})`);
  await prisma.$disconnect();
  process.exit(rows.length ? 1 : 0);
}

main().catch((e) => { console.error("RECONCILE ERROR:", e?.message || e); process.exit(2); });
