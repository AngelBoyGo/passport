import { describe, it, expect } from "vitest";
import {
  computeStreak,
  resolveStreakLevel,
  getStreakEmoji,
  openStreakChest,
  streakUrgencyColor,
  streakUrgencyLabel,
} from "@/lib/engagement/streaks";

const NOW = "2026-08-28T12:00:00.000Z";

function h(hoursAgo: number): string {
  return new Date(Date.parse(NOW) - hoursAgo * 3600 * 1000).toISOString();
}

function d(daysAgo: number): string {
  return new Date(Date.parse(NOW) - daysAgo * 86400 * 1000).toISOString();
}

describe("computeStreak", () => {
  it("returns zero streak for no evidence", () => {
    const r = computeStreak({ recentEvidenceDates: [], now: NOW });
    expect(r.currentStreak).toBe(0);
    expect(r.isActive).toBe(false);
    expect(r.flameEmoji).toBe("");
    expect(r.streakLevel).toBe("none");
  });

  it("counts streak of 1 for a single evidence within 48h", () => {
    const r = computeStreak({ recentEvidenceDates: [h(2)], now: NOW });
    expect(r.currentStreak).toBe(1);
    expect(r.isActive).toBe(true);
    expect(r.flameEmoji).toBe("✨");
  });

  it("counts streak of 3 for evidence on 3 consecutive days", () => {
    const r = computeStreak({
      recentEvidenceDates: [d(0), d(1), d(2)],
      now: NOW,
    });
    expect(r.currentStreak).toBe(3);
    expect(r.flameEmoji).toBe("🔥");
    expect(r.streakLevel).toBe("warm");
  });

  it("breaks streak if gap exceeds 48h", () => {
    const r = computeStreak({
      recentEvidenceDates: [d(0), d(3)],
      now: NOW,
    });
    expect(r.currentStreak).toBe(1);
  });

  it("flags streak as inactive if last evidence was >48h ago", () => {
    const r = computeStreak({
      recentEvidenceDates: [h(50)],
      now: NOW,
    });
    expect(r.currentStreak).toBe(1);
    expect(r.isActive).toBe(false);
    expect(r.expiresAt).toBeNull();
  });

  it("tracks longest streak separate from current", () => {
    // 5 consecutive days, then 3 day gap, then 2 more → current=5, longest=5
    const dates = [d(0), d(1), d(2), d(3), d(4), d(8), d(9)];
    const r = computeStreak({ recentEvidenceDates: dates, now: NOW });
    expect(r.currentStreak).toBe(5);
    expect(r.longestStreak).toBe(5);
  });

  it("correctly identifies longest streak when current is shorter", () => {
    // most recent: 2 days, then 3-day gap, then 6-day streak in past
    const dates = [d(0), d(1), d(5), d(8), d(9), d(10), d(11), d(12), d(13)];
    const r = computeStreak({ recentEvidenceDates: dates, now: NOW });
    // current: days 0-1 (2 days), longest: days 8-13 (6 days)
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(6);
  });

  it("shows hours until expiry", () => {
    const r = computeStreak({ recentEvidenceDates: [h(10)], now: NOW });
    expect(r.hoursUntilExpiry).toBeGreaterThan(0);
    expect(r.hoursUntilExpiry).toBeLessThanOrEqual(48);
  });

  it("reaches inferno level at 30+", () => {
    const dates = Array.from({ length: 30 }, (_, i) => d(i));
    const r = computeStreak({ recentEvidenceDates: dates, now: NOW });
    expect(r.currentStreak).toBeGreaterThanOrEqual(30);
    expect(r.streakLevel).toBe("inferno");
    expect(r.flameEmoji).toBe("🔱");
  });

  it("chestAvailable is true every 3 days", () => {
    const r3 = computeStreak({ recentEvidenceDates: [d(0), d(1), d(2)], now: NOW });
    expect(r3.chestAvailable).toBe(true);
    expect(r3.daysUntilNextChest).toBe(0);

    const r2 = computeStreak({ recentEvidenceDates: [d(0), d(1)], now: NOW });
    expect(r2.chestAvailable).toBe(false);
    expect(r2.daysUntilNextChest).toBe(1);
  });

  it("chestAvailable is false if streak is inactive", () => {
    const r = computeStreak({ recentEvidenceDates: [h(60)], now: NOW });
    expect(r.chestAvailable).toBe(false);
  });
});

describe("resolveStreakLevel", () => {
  it("none at 0", () => expect(resolveStreakLevel(0)).toBe("none"));
  it("spark at 1", () => expect(resolveStreakLevel(1)).toBe("spark"));
  it("warm at 3", () => expect(resolveStreakLevel(3)).toBe("warm"));
  it("hot at 7", () => expect(resolveStreakLevel(7)).toBe("hot"));
  it("burning at 14", () => expect(resolveStreakLevel(14)).toBe("burning"));
  it("inferno at 30", () => expect(resolveStreakLevel(30)).toBe("inferno"));
});

describe("openStreakChest", () => {
  it("always returns at least 5 credits", () => {
    const r = openStreakChest(3);
    expect(r.credits).toBeGreaterThanOrEqual(5);
  });
});

describe("streakUrgencyColor", () => {
  it("returns green for safe streak", () => expect(streakUrgencyColor(24)).toBe("#22c55e"));
  it("returns amber for warning", () => expect(streakUrgencyColor(5)).toBe("#f59e0b"));
  it("returns red for critical", () => expect(streakUrgencyColor(1)).toBe("#ef4444"));
  it("returns slate for no streak", () => expect(streakUrgencyColor(null)).toBe("#64748b"));
});

describe("streakUrgencyLabel", () => {
  it("motivates with countdown when expiring", () => {
    const label = streakUrgencyLabel(3.5);
    expect(label).toContain("until streak resets");
  });
});