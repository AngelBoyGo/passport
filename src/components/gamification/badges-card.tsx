"use client";

import { useState, useCallback, useEffect } from "react";
import { ALL_BADGES, BADGE_RARITY_GLOW } from "@/lib/engagement/achievements";
import { ShareCard } from "./share-card";

interface AchievementBadgeData {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: string;
  color: string;
  isNew: boolean;
}

/**
 * Badges gallery — shows unlocked + locked badges.
 * Psychology: collection completion (pokemon effect), social status,
 * variable rewards (unexpected unlocks trigger dopamine).
 */
export function BadgesCard() {
  const [badges, setBadges] = useState<AchievementBadgeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBadgeId, setNewBadgeId] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string>("");

  useEffect(() => {
    loadBadges();
    // Try to get the commitment from the URL or a data attribute
    const el = document.querySelector("[data-commitment]");
    if (el) setCommitment(el.getAttribute("data-commitment") || "");
  }, []);

  const loadBadges = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/achievements", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setBadges(data.badges ?? []);
        const newest = data.badges?.find((b: AchievementBadgeData) => b.isNew);
        if (newest) {
          setNewBadgeId(newest.id);
          setTimeout(() => setNewBadgeId(null), 10000);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-3" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-16 bg-slate-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const unlockedCount = badges.filter((b) => b.isNew || true).length;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🏆</span> Achievements
        </h2>
        <span className="text-xs text-slate-400">{unlockedCount}/{ALL_BADGES.length}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {badges.map((badge) => {
          const isNew = badge.id === newBadgeId;
          return (
            <div
              key={badge.id}
              className={`rounded-lg border p-2 text-center transition-all duration-500 ${
                isNew ? "ring-2 ring-amber-400 scale-110" : ""
              } ${BADGE_RARITY_GLOW[badge.rarity as keyof typeof BADGE_RARITY_GLOW] ?? "border-slate-700"}`}
              style={{
                backgroundColor: badge.color + "10",
                borderColor: badge.color + "40",
                opacity: isNew ? 1 : 0.85,
              }}
              title={badge.description}
            >
              <p className="text-xl">{badge.emoji}</p>
              <p className="text-[10px] font-medium text-slate-300 mt-0.5 leading-tight">{badge.name}</p>
              {isNew && (
                <span className="text-[8px] font-bold text-amber-400 animate-pulse">NEW!</span>
              )}
            </div>
          );
        })}
      </div>

      {newBadgeId && (
        <div className="space-y-3">
          <div className="rounded-lg bg-gradient-to-r from-amber-950/40 to-purple-950/40 border border-amber-500/30 p-3 text-center animate-pulse">
            <p className="text-sm font-bold text-amber-300">
              🎉 New Achievement Unlocked!
            </p>
          </div>
          {commitment && (
            <ShareCard
              type="badge"
              commitment={commitment}
              details={{
                title: badges.find((b) => b.id === newBadgeId)?.name || "Achievement Unlocked",
                description: badges.find((b) => b.id === newBadgeId)?.description || "",
                emoji: badges.find((b) => b.id === newBadgeId)?.emoji || "🏆",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}