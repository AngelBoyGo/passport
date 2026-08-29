"use client";

import { useState } from "react";

interface ShareCardProps {
  /** The achievement type */
  type: "level_up" | "badge" | "streak" | "chest" | "milestone";
  /** Agent commitment hash */
  commitment: string;
  /** Achievement details */
  details: {
    title: string;
    description: string;
    emoji?: string;
    tier?: string;
    score?: number;
    streak?: number;
  };
}

const TWEET_TEMPLATES: Record<string, (d: ShareCardProps["details"], c: string) => string> = {
  level_up: (d, c) =>
    `I just hit ${d.tier} on @Passport! 🏆 Score: ${d.score}\n\nMy AI agent is cryptographically verified — every action signed with Ed25519.\n\nCheck my trust report: https://passport.metis.gold/verify/${c}`,
  badge: (d, c) =>
    `Unlocked the "${d.title}" badge on @Passport! 🎖️ ${d.emoji}\n\n${d.description}\n\nView my achievements: https://passport.metis.gold/verify/${c}`,
  streak: (d, c) =>
    `${d.emoji} ${d.streak}-day activity streak on @Passport!\n\nConsistency is trust. Every day my agent posts signed evidence.\n\nSee the streak: https://passport.metis.gold/verify/${c}`,
  chest: (d, c) =>
    `🎁 Just opened a Streak Chest on @Passport! ${d.description}\n\nVariable rewards keep me coming back. Try it:\nhttps://passport.metis.gold`,
  milestone: (d, c) =>
    `🚀 ${d.title} on @Passport!\n\n${d.description}\n\nMy agent's reputation is verifiable by anyone:\nhttps://passport.metis.gold/verify/${c}`,
};

/**
 * Viral share card — one-click share to Twitter/X.
 * Appears on level ups, badge unlocks, streak milestones, chest openings.
 * Psychology: social proof, status signaling, network effect.
 */
export function ShareCard({ type, commitment, details }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const tweetText = TWEET_TEMPLATES[type]?.(details, commitment) ?? "";
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
  const baseUrl = "https://passport.metis.gold";
  const verifyUrl = `${baseUrl}/verify/${commitment}`;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 to-purple-950/40 p-5 shadow-sm space-y-4 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{details.emoji || "🎉"}</span>
          <div>
            <p className="text-sm font-bold text-white">{details.title}</p>
            <p className="text-xs text-slate-400">{details.description}</p>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-slate-500 hover:text-slate-300 text-sm"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={tweetUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Share on X
        </a>
        <button
          onClick={() => {
            navigator.clipboard.writeText(verifyUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
        >
          {copied ? "✓ Copied!" : "Copy Link"}
        </button>
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
        >
          LinkedIn
        </a>
      </div>
    </div>
  );
}