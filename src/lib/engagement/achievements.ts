/**
 * Achievement badge system — pure function, no DB dependency.
 *
 * Psychology: status symbols (badge collection), variable rewards (unexpected unlocks),
 * endowment effect (my badges), social proof (visible on profile).
 */

export type BadgeRarity = "common" | "uncommon" | "rare" | "legendary";

export interface AchievementBadge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: BadgeRarity;
  color: string;
  condition: (input: AchievementInput) => boolean;
}

export interface AchievementInput {
  evidenceCount: number;
  streakDays: number;
  reputationScore: number;
  reputationTier: string;
  artifactCount: number;
  hasEnrollmentPhoto: boolean;
  correctionCount: number;
  daysSinceEnrolled: number;
}

export interface UnlockedBadge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: BadgeRarity;
  color: string;
  unlockedAt: string;
  isNew: boolean;
}

const BADGE_COLORS: Record<BadgeRarity, string> = {
  common: "#64748b",
  uncommon: "#22c55e",
  rare: "#6366f1",
  legendary: "#f59e0b",
};

export const ALL_BADGES: AchievementBadge[] = [
  {
    id: "first_steps",
    name: "First Steps",
    description: "Submit your first evidence entry",
    emoji: "👣",
    rarity: "common",
    color: BADGE_COLORS.common,
    condition: (i) => i.evidenceCount >= 1,
  },
  {
    id: "evidence_collector",
    name: "Evidence Collector",
    description: "Accumulate 10 evidence entries",
    emoji: "📚",
    rarity: "common",
    color: BADGE_COLORS.common,
    condition: (i) => i.evidenceCount >= 10,
  },
  {
    id: "century",
    name: "Century",
    description: "Submit 100 evidence entries",
    emoji: "💯",
    rarity: "uncommon",
    color: BADGE_COLORS.uncommon,
    condition: (i) => i.evidenceCount >= 100,
  },
  {
    id: "streak_spark",
    name: "Streak Spark",
    description: "Reach a 3-day activity streak",
    emoji: "✨",
    rarity: "common",
    color: BADGE_COLORS.common,
    condition: (i) => i.streakDays >= 3,
  },
  {
    id: "streak_burning",
    name: "Burning Streak",
    description: "Maintain a 14-day activity streak",
    emoji: "🔥",
    rarity: "rare",
    color: BADGE_COLORS.rare,
    condition: (i) => i.streakDays >= 14,
  },
  {
    id: "streak_inferno",
    name: "Inferno",
    description: "Achieve a 30-day activity streak",
    emoji: "🔱",
    rarity: "legendary",
    color: BADGE_COLORS.legendary,
    condition: (i) => i.streakDays >= 30,
  },
  {
    id: "silver_tier",
    name: "Silver Standard",
    description: "Reach Silver reputation tier",
    emoji: "🥈",
    rarity: "uncommon",
    color: BADGE_COLORS.uncommon,
    condition: (i) => i.reputationTier === "Silver" || i.reputationTier === "Gold" || i.reputationTier === "Platinum" || i.reputationTier === "Diamond",
  },
  {
    id: "gold_tier",
    name: "Gold Rush",
    description: "Reach Gold reputation tier",
    emoji: "🥇",
    rarity: "rare",
    color: BADGE_COLORS.rare,
    condition: (i) => i.reputationTier === "Gold" || i.reputationTier === "Platinum" || i.reputationTier === "Diamond",
  },
  {
    id: "diamond_tier",
    name: "Diamond Hands",
    description: "Reach Diamond reputation tier",
    emoji: "💎",
    rarity: "legendary",
    color: BADGE_COLORS.legendary,
    condition: (i) => i.reputationTier === "Diamond",
  },
  {
    id: "artifact_multitool",
    name: "Multi-Tool",
    description: "Produce 10 different artifacts",
    emoji: "🛠️",
    rarity: "uncommon",
    color: BADGE_COLORS.uncommon,
    condition: (i) => i.artifactCount >= 10,
  },
  {
    id: "perfectionist",
    name: "Perfectionist",
    description: "Zero corrections, 50+ evidence entries",
    emoji: "⭐",
    rarity: "rare",
    color: BADGE_COLORS.rare,
    condition: (i) => i.evidenceCount >= 50 && i.correctionCount === 0,
  },
  {
    id: "veteran",
    name: "Veteran",
    description: "Active for 90+ days",
    emoji: "🎖️",
    rarity: "rare",
    color: BADGE_COLORS.rare,
    condition: (i) => i.daysSinceEnrolled >= 90,
  },
];

/**
 * Computes which badges are unlocked given the current state.
 * Returns newly unlocked badges (not previously seen).
 */
export function computeAchievements(
  input: AchievementInput,
  previouslyUnlockedIds: string[]
): UnlockedBadge[] {
  const now = new Date().toISOString();
  const unlocked: UnlockedBadge[] = [];

  for (const badge of ALL_BADGES) {
    const alreadyUnlocked = previouslyUnlockedIds.includes(badge.id);
    const shouldUnlock = badge.condition(input);

    if (shouldUnlock) {
      unlocked.push({
        ...badge,
        unlockedAt: now,
        isNew: !alreadyUnlocked,
      });
    }
  }

  return unlocked;
}

/**
 * Color-theory optimized badge CSS classes for different emotional responses.
 */
export const BADGE_RARITY_GLOW: Record<BadgeRarity, string> = {
  common: "shadow-sm border-slate-300",
  uncommon: "shadow-md border-green-400 shadow-green-500/10",
  rare: "shadow-lg border-indigo-400 shadow-indigo-500/20",
  legendary: "shadow-xl border-amber-400 shadow-amber-500/30 animate-pulse",
};