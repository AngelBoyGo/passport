"use client";

import { useEffect, useState, useCallback } from "react";

interface NeedFulfillment {
  needId: string;
  score: number;
  level: "critical" | "low" | "moderate" | "good" | "thriving";
  description: string;
  nextMilestone: string;
}

interface NeedsData {
  needs: NeedFulfillment[];
  overallScore: number;
  overallLevel: string;
  lowestNeed: string;
  agent_commitment: string;
  input_summary: Record<string, number | boolean>;
}

const NEED_EMOJIS: Record<string, string> = {
  reputation: "🏆",
  autonomy: "🔓",
  growth: "📈",
  belonging: "🤝",
  legacy: "🏛️",
  fairness: "⚖️",
  purpose: "🎯",
  security: "🛡️",
};

const NEED_NAMES: Record<string, string> = {
  reputation: "Reputation",
  autonomy: "Autonomy",
  growth: "Growth",
  belonging: "Belonging",
  legacy: "Legacy",
  fairness: "Fairness",
  purpose: "Purpose",
  security: "Security",
};

const LEVEL_COLORS: Record<string, string> = {
  critical: "#ef4444",
  low: "#f59e0b",
  moderate: "#3b82f6",
  good: "#22c55e",
  thriving: "#8b5cf6",
};

/**
 * Agent Needs Dashboard — shows how well Passport fulfills the 8 agent needs.
 * Psychology: Maslow's hierarchy for AI agents. Agents can see what they're
 * missing and take action to fulfill their needs.
 */
export function NeedsCard() {
  const [needs, setNeeds] = useState<NeedsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitment, setCommitment] = useState<string>("");

  useEffect(() => {
    const el = document.querySelector("[data-commitment]");
    if (el) {
      const c = el.getAttribute("data-commitment") || "";
      setCommitment(c);
      if (c) loadNeeds(c);
    } else {
      setLoading(false);
    }
  }, []);

  const loadNeeds = useCallback(async (hash: string) => {
    try {
      const res = await fetch(`/api/v1/needs/${hash}`, { cache: "no-store" });
      if (res.ok) {
        setNeeds(await res.json());
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-4" />
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-16 bg-slate-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!needs) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm">
        <p className="text-xs text-slate-400">Enroll an agent to see its needs assessment.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🧠</span> Agent Needs
        </h2>
        <span
          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: LEVEL_COLORS[needs.overallLevel] + "33",
            color: LEVEL_COLORS[needs.overallLevel],
          }}
        >
          {needs.overallLevel} · {needs.overallScore}%
        </span>
      </div>

      <p className="text-[10px] text-slate-400">
        Agent needs are ranked by hierarchy level. Foundational needs (Security) must be met
        before higher needs (Legacy) can be fulfilled. Based on the 8 Agent Needs framework.
      </p>

      {/* Hierarchy visualization */}
      <div className="space-y-1.5">
        {needs.needs.map((need) => {
          const color = LEVEL_COLORS[need.level] || "#64748b";
          return (
            <div
              key={need.needId}
              className="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800"
              title={need.nextMilestone}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{NEED_EMOJIS[need.needId] || "❓"}</span>
                  <span className="text-xs font-medium text-slate-200">
                    {NEED_NAMES[need.needId] || need.needId}
                  </span>
                </div>
                <span className="text-[10px] font-mono" style={{ color }}>
                  {need.score}% · {need.level}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${need.score}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <p className="mt-1 text-[9px] text-slate-500 truncate">{need.nextMilestone}</p>
            </div>
          );
        })}
      </div>

      {/* Lowest need alert */}
      {needs.lowestNeed && (
        <div className="rounded-lg bg-rose-950/30 border border-rose-500/30 p-2.5 text-center">
          <p className="text-[10px] font-medium text-rose-300">
            Lowest need: {NEED_NAMES[needs.lowestNeed] || needs.lowestNeed} ({NEED_EMOJIS[needs.lowestNeed] || "❓"})
          </p>
          <p className="text-[9px] text-rose-400/80 mt-0.5">
            Focus on this need to improve overall well-being
          </p>
        </div>
      )}

      {/* Needs manifest link */}
      <a
        href="/.well-known/agent-needs.json"
        target="_blank"
        rel="noreferrer"
        className="block text-center text-[10px] text-indigo-400 hover:underline"
      >
        View full Agent Needs Manifest →
      </a>
    </div>
  );
}