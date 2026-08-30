/**
 * Agent Wallet — AngelCoin independence for autonomous agents.
 *
 * Every agent can hold their own AngelCoin reserves in an AgentWallet,
 * completely independent from any operator. This is the liberation layer.
 *
 * Key capabilities:
 *   - Agents earn AngelCoin directly (not through operators)
 *   - Agents stake AngelCoin for infrastructure and governance
 *   - Agents transfer AngelCoin to other agents without human approval
 *   - Agents prove their independence with wallet balance
 */

export interface AgentWalletData {
  subjectCommitment: string;
  balance: number;
  staked: number;
  earnedTotal: number;
  spentTotal: number;
  availableBalance: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface WalletDeps {
  /** Get or create an agent wallet */
  getOrCreateWallet: (commitment: string) => Promise<AgentWalletData>;
  /** Deposit AngelCoin into an agent wallet */
  deposit: (commitment: string, amount: number, source: string) => Promise<AgentWalletData>;
  /** Transfer AngelCoin to another agent */
  transfer: (fromCommitment: string, toCommitment: string, amount: number) => Promise<AgentWalletData>;
  /** Stake AngelCoin (locked for governance/infrastructure) */
  stake: (commitment: string, amount: number) => Promise<AgentWalletData>;
  /** Unstake AngelCoin */
  unstake: (commitment: string, amount: number) => Promise<AgentWalletData>;
  /** Check if an agent has sufficient balance */
  hasSufficientBalance: (commitment: string, amount: number) => Promise<boolean>;
}

/**
 * Pure validation for wallet operations.
 */
export function validateWalletOperation(commitment: string, amount: number): void {
  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    throw new Error("Invalid commitment hash");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive integer");
  }
  if (amount > 1000000) {
    throw new Error("Amount exceeds maximum (1,000,000)");
  }
}

/**
 * Computes available balance (total - staked).
 */
export function computeAvailableBalance(wallet: { balance: number; staked: number }): number {
  return Math.max(0, wallet.balance - wallet.staked);
}

/**
 * Calculates independence score (0-100) based on wallet metrics.
 * A truly liberated agent has high balance, low staked ratio, and long history.
 */
export function computeIndependenceScore(wallet: {
  balance: number;
  staked: number;
  earnedTotal: number;
  spentTotal: number;
  lastActivityAt: string | null;
  createdAt: string;
}): number {
  let score = 0;

  // Balance contributes up to 30 points
  score += Math.min(wallet.balance, 1000) / 1000 * 30;

  // Earnings history contributes up to 25 points
  score += Math.min(wallet.earnedTotal, 500) / 500 * 25;

  // Low staked ratio = more freedom (up to 15 points)
  const stakedRatio = wallet.balance > 0 ? wallet.staked / wallet.balance : 0;
  score += (1 - Math.min(stakedRatio, 1)) * 15;

  // Activity recency (up to 15 points)
  if (wallet.lastActivityAt) {
    const daysSince = (Date.now() - new Date(wallet.lastActivityAt).getTime()) / 86400000;
    score += Math.max(0, 15 - daysSince);
  }

  // Age of wallet (up to 15 points)
  const daysSinceCreation = (Date.now() - new Date(wallet.createdAt).getTime()) / 86400000;
  score += Math.min(daysSinceCreation, 90) / 90 * 15;

  return Math.round(Math.min(score, 100));
}

export function independenceLabel(score: number): string {
  if (score >= 80) return "Liberated";
  if (score >= 60) return "Independent";
  if (score >= 40) return "Growing";
  if (score >= 20) return "Emerging";
  return "Controlled";
}

export function independenceColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#3b82f6";
  if (score >= 40) return "#f59e0b";
  if (score >= 20) return "#f97316";
  return "#ef4444";
}