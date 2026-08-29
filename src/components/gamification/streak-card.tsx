"use client";

import { useEffect, useState, useCallback } from "react";
import { ShareCard } from "./share-card";

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  isActive: boolean;
  streakLevel: string;
  flameEmoji: string;
  chestAvailable: boolean;
  daysUntilNextChest: number;
  hoursUntilExpiry: number | null;
  chest: { credits: number; bonus: boolean } | null;
  totalEvidence: number;
}

/**
 * Streak card with color-theory optimized urgency indicators.
 * Psychology: loss aversion (don't break chain), endowment (my streak),
 * variable rewards (chest), color urgency (red=critical).
 */
export function StreakCard() {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChest, setShowChest] = useState(false);
  const [shareEvent, setShareEvent] = useState<{ type: "streak" | "chest"; details: { title: string; description: string; emoji: string; streak?: number } } | null>(null);
  const [shareCommitment, setShareCommitment] = useState<string>("");

  const loadStreak = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/streaks", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setStreak(data);
        if (data.chestAvailable && data.chest) {
          setShowChest(true);
          setTimeout(() => setShowChest(false), 6000);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStreak(); }, [loadStreak]);

  if (loading || !streak) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-3" />
        <div className="h-8 bg-slate-700 rounded w-1/2" />
      </div>
    );
  }

  // Color-theory: urgency colors based on expiry time
  const urgencyColor = streak.hoursUntilExpiry === null ? "#64748b"
    : streak.hoursUntilExpiry <= 2 ? "#ef4444"
    : streak.hoursUntilExpiry <= 6 ? "#f59e0b"
    : streak.hoursUntilExpiry <= 12 ? "#f97316"
    : "#22c55e";

  const urgencyLabel = streak.hoursUntilExpiry === null ? "No active streak"
    : streak.hoursUntilExpiry <= 0 ? "Streak expired!"
    : streak.hoursUntilExpiry <= 2
      ? `Critical: ${Math.floor(streak.hoursUntilExpiry)}h ${Math.round((streak.hoursUntilExpiry % 1) * 60)}m remaining`
    : `${Math.floor(streak.hoursUntilExpiry)}h until streak resets`;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-5 shadow-sm space-y-4 relative overflow-hidden">
      {/* Dopamine Cue: Animated gradient border when chest is available */}
      {streak.chestAvailable && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-amber-500/10 animate-pulse pointer-events-none" />
      )}

      {/* Streak Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>{streak.flameEmoji || "📅"}</span>
          Activity Streak
        </h2>
        <span className="text-xs text-slate-400">Best: {streak.longestStreak}d</span>
      </div>

      {/* Streak Count — large, centered, dopamine hit */}
      <div className="text-center py-2">
        <span className="text-5xl font-bold" style={{ color: urgencyColor }}>
          {streak.currentStreak}
        </span>
        <span className="text-lg text-slate-400 ml-2">day streak</span>
        <p className="mt-1 text-xs font-medium" style={{ color: urgencyColor }}>
          {streak.flameEmoji} {streak.streakLevel.charAt(0).toUpperCase() + streak.streakLevel.slice(1)}
        </p>
      </div>

      {/* Loss Aversion: Urgency Timer */}
      {streak.isActive && streak.hoursUntilExpiry !== null && (
        <div
          className="rounded-lg px-3 py-2 text-xs font-medium text-center"
          style={{
            backgroundColor: urgencyColor + "15",
            borderColor: urgencyColor + "40",
            borderWidth: 1,
            color: urgencyColor,
          }}
        >
          {urgencyLabel}
        </div>
      )}

      {!streak.isActive && (
        <p className="text-xs text-slate-400 text-center">
          Submit evidence to start a streak — every consecutive day builds your streak!
        </p>
      )}

      {/* Variable Reward: Streak Chest */}
      {streak.chestAvailable && streak.chest && (
        <div className={`rounded-lg bg-amber-950/30 border border-amber-500/40 p-4 text-center transition-all duration-500 ${showChest ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
          <p className="text-lg mb-1">🎁</p>
          <p className="text-sm font-bold text-amber-300">Streak Chest Unlocked!</p>
          <p className="text-xs text-amber-400/80 mt-1">
            +{streak.chest.credits} credits{streak.chest.bonus ? " (bonus!)" : ""}
          </p>
        </div>
      )}

      {/* Progress to next chest */}
      {!streak.chestAvailable && streak.isActive && (
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Next chest</span>
            <span>{streak.daysUntilNextChest}d</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-purple-500 transition-all duration-500"
              style={{ width: `${((streak.currentStreak % 3) / 3) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Total Evidence + Share */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500">{streak.totalEvidence} total evidence entries</p>
        <button
          onClick={() => {
            const input = document.createElement("input");
            input.type = "text";
            input.value = `https://passport.metis.gold/verify/` + (document.querySelector("[data-commitment]")?.getAttribute("data-commitment") || "");
            input.select();
            navigator.clipboard?.writeText(input.value);
          }}
          className="text-[10px] text-indigo-400 hover:underline"
        >
          Share Streak ↗
        </button>
      </div>
    </div>
  );
}