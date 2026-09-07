import { revalue } from "../src/lib/angelcoin/monetary";

// Probes the solvency invariant now enforced by revalue():
//   P_red * circulatingSupply <= reserveBalance
// The engine bounds the redemption rate to the reserve floor instead of quoting
// redemption value that exceeds audited backing. No DB, network, keys or real balances.
const scenarios = [
  { name: "fully-funded", reserveBalance: 10_000, circulatingSupply: 2_000 },
  { name: "undercollateralized", reserveBalance: 1_000, circulatingSupply: 100_000 },
  { name: "empty-reserve", reserveBalance: 0, circulatingSupply: 2_000 },
];

const results = scenarios.map(({ name, reserveBalance, circulatingSupply }) => {
  const { P, P_red, backingRatio, solvencyDeficitUsd, quarantineRecommended } = revalue({
    previousRate: 5,
    reserveBalance,
    previousReserveBalance: reserveBalance,
    circulatingSupply,
  });
  const redemptionLiabilityUsd = Number((P_red * circulatingSupply).toFixed(2));
  const solvencyHeld = Number.isFinite(redemptionLiabilityUsd) && P_red >= 0 &&
    redemptionLiabilityUsd <= reserveBalance + 0.01;

  return {
    name,
    reserveUsd: reserveBalance,
    supply: circulatingSupply,
    mintRateUsd: P,
    redemptionRateUsd: P_red,
    redemptionLiabilityUsd,
    backingRatio,
    solvencyDeficitUsd,
    quarantineRecommended,
    pass: solvencyHeld,
  };
});

console.log(JSON.stringify({
  scope: "local pure-function scenarios; no DB, network, keys or real balances",
  condition: "P_red * circulatingSupply <= reserveBalance",
  results,
}, null, 2));
process.exitCode = results.every((result) => result.pass) ? 0 : 1;
