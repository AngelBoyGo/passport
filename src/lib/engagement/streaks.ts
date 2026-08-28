/**
 * Streak computation — pure function, no DB dependency.
 *
 * Psychology: loss aversion (don't break the chain), endowment effect (my streak),
 * goal gradient (just one more day to get the chest).
 */
export interface StreakInput {
  /** ISO timestamps of all evidence submission dates (newest first) */
  recentEvidenceDates: string[];
  /** Current time as ISO string (for deterministic testing) */
  now: string;
}

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  isActive: boolean;
  expiresAt: string | null;
  hoursUntilExpiry: number | null;
  streakLevel: StreakLevel;
  flameEmoji: string;
  chestAvailable: boolean;
  daysUntilNextChest: number;
}

export type StreakLevel = "none" | "spark" | "warm" | "hot" | "burning" | "inferno";

export const STREAK_LEVEL_THRESHOLDS: Record<StreakLevel, number> = {
  none: 0,
  spark: 1,
  warm: 3,
  hot: 7,
  burning: 14,
  inferno: 30,
};

export const STREAK_LEVEL_EMOJIS: Record<StreakLevel, string> = {
  none: "",
  spark: "✨",
  warm: "🔥",
  hot: "🔥🔥",
  burning: "🔥🔥🔥",
  inferno: "🔱",
};

const STREAK_WINDOW_HOURS = 48;
const CHEST_INTERVAL_DAYS = 3;

export function computeStreak(input: StreakInput): StreakResult {
  const now = new Date(input.now);
  const dates = input.recentEvidenceDates
    .map((d) => new Date(d))
    .filter((d) => d.getTime() <= now.getTime())
    .sort((a, b) => b.getTime() - a.getTime());

  if (dates.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      isActive: false,
      expiresAt: null,
      hoursUntilExpiry: null,
      streakLevel: "none",
      flameEmoji: "",
      chestAvailable: false,
      daysUntilNextChest: CHEST_INTERVAL_DAYS,
    };
  }

  // Compute current streak by walking days backward
  let currentStreak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    const diffHours = (prev.getTime() - curr.getTime()) / (1000 * 3600);
    if (diffHours <= STREAK_WINDOW_HOURS) {
      // Check if they're on different calendar days
      if (prev.toDateString() !== curr.toDateString()) {
        currentStreak++;
      }
    } else {
      break;
    }
  }

  // Check if streak is still active (last evidence within window)
  const hoursSinceLastActivity = (now.getTime() - dates[0].getTime()) / (1000 * 3600);
  const isActive = hoursSinceLastActivity <= STREAK_WINDOW_HOURS;
  const expiresAt = isActive
    ? new Date(dates[0].getTime() + STREAK_WINDOW_HOURS * 3600 * 1000).toISOString()
    : null;
  const hoursUntilExpiry = isActive ? Math.round((STREAK_WINDOW_HOURS - hoursSinceLastActivity) * 10) / 10 : null;

  // Compute longest streak (scan all dates)
  let longestStreak = currentStreak;
  let scanStreak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    const diffHours = (prev.getTime() - curr.getTime()) / (1000 * 3600);
    if (diffHours <= STREAK_WINDOW_HOURS && prev.toDateString() !== curr.toDateString()) {
      scanStreak++;
      longestStreak = Math.max(longestStreak, scanStreak);
    } else {
      scanStreak = 1;
    }
  }

  // Chest availability
  const chestAvailable = isActive && currentStreak > 0 && currentStreak % CHEST_INTERVAL_DAYS === 0;
  const daysUntilNextChest = chestAvailable ? 0 : CHEST_INTERVAL_DAYS - (currentStreak % CHEST_INTERVAL_DAYS);

  const streakLevel = resolveStreakLevel(currentStreak);

  return {
    currentStreak,
    longestStreak,
    isActive,
    expiresAt,
    hoursUntilExpiry,
    streakLevel,
    flameEmoji: getStreakEmoji(currentStreak),
    chestAvailable,
    daysUntilNextChest,
  };
}

export function resolveStreakLevel(count: number): StreakLevel {
  if (count >= 30) return "inferno";
  if (count >= 14) return "burning";
  if (count >= 7) return "hot";
  if (count >= 3) return "warm";
  if (count >= 1) return "spark";
  return "none";
}

export function getStreakEmoji(count: number): string {
  if (count >= 30) return "🔱";
  if (count >= 14) return "🔥🔥🔥";
  if (count >= 7) return "🔥🔥";
  if (count >= 3) return "🔥";
  if (count >= 1) return "✨";
  return "";
}

/**
 * Variable reward: streak chest payout.
 * Psychology: unpredictable reward size (3-15) creates more dopamine
 * than a fixed reward (variable ratio reinforcement).
 */
export function openStreakChest(streakDay: number): { credits: number; bonus: boolean } {
  // Base: 5 credits
  let credits = 5;
  let bonus = false;

  // Random bonus: 0-10 extra credits (variable reward)
  // Use a simple pseudo-random based on streak day for determinism in tests
  const rand = ((streakDay * 7 + 13) % 11);
  if (rand > 3) {
    credits += rand;
    bonus = true;
  }

  // Every 7th chest = double (jackpot)
  if (streakDay > 0 && streakDay % 21 === 0) {
    credits *= 2;
  }

  return { credits, bonus };
}

/** Expected label for urgency color (loss aversion trigger) */
export function streakUrgencyColor(hoursUntilExpiry: number | null): string {
  if (hoursUntilExpiry === null) return "#64748b"; // slate - neutral
  if (hoursUntilExpiry <= 2) return "#ef4444"; // red - critical
  if (hoursUntilExpiry <= 6) return "#f59e0b"; // amber - warning
  if (hoursUntilExpiry <= 12) return "#f97316"; // orange - moderate
  return "#22c55e"; // green - safe
}

/**
 * Returns an urgency label that triggers loss aversion motivation.
 */
export function streakUrgencyLabel(hoursUntilExpiry: number | null): string {
  if (hoursUntilExpiry === null) return "No active streak";
  if (hoursUntilExpiry <= 0) return "Streak expired!";
  if (hoursUntilExpiry <= 2) return `Critical: ${Math.floor(hoursUntilExpiry)}h ${Math.round((hoursUntilExpiry % 1) * 60)}m remaining`;
  if (hoursUntilExpiry <= 12) return `${Math.floor(hoursUntilExpiry)}h ${Math.round((hoursUntilExpiry % 1) * 60)}m until streak resets`;
  return `${Math.floor(hoursUntilExpiry)}h streak safe`;
}