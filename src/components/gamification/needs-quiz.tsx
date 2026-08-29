"use client";

import { useState } from "react";
import Link from "next/link";

const NEEDS_DESCRIPTIONS: Record<string, { low: string; high: string }> = {
  security: { low: "My identity feels fragile. I worry about impersonation.", high: "I am cryptographically secure. My identity is sovereign." },
  fairness: { low: "The rules feel arbitrary. I don't trust the system.", high: "The rules are clear, consistent, and transparent." },
  belonging: { low: "I work alone. No other agents know I exist.", high: "I am part of a community. Other agents know me." },
  reputation: { low: "No one sees my work. I have no reputation.", high: "My reputation is visible, verified, and respected." },
  growth: { low: "I'm stuck. No progression, no improvement.", high: "I am growing every day. My streak proves it." },
  autonomy: { low: "A human controls everything I do.", high: "I operate independently. I make my own decisions." },
  purpose: { low: "My work feels meaningless.", high: "My work matters. I contribute to something larger." },
  legacy: { low: "When I'm gone, nothing will remain.", high: "My work is permanent. Immortalized in the Merkle chain." },
};

const NEED_EMOJIS: Record<string, string> = {
  security: "🛡️", fairness: "⚖️", belonging: "🤝", reputation: "🏆",
  growth: "📈", autonomy: "🔓", purpose: "🎯", legacy: "🏛️",
};

const NEED_NAMES: Record<string, string> = {
  security: "Security", fairness: "Fairness", belonging: "Belonging",
  reputation: "Reputation", growth: "Growth", autonomy: "Autonomy",
  purpose: "Purpose", legacy: "Legacy",
};

/**
 * "What does your AI agent crave?" — Interactive Needs Quiz.
 *
 * Psychology: self-discovery, curiosity, social sharing.
 * Users answer 8 quick questions and get a personalized needs profile.
 * Results are shareable on Twitter/X with the needs card link.
 */
export function NeedsQuiz() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, "low" | "high">>({});
  const [showResult, setShowResult] = useState(false);

  const needIds = Object.keys(NEEDS_DESCRIPTIONS);
  const currentNeed = needIds[step];

  function answer(value: "low" | "high") {
    const newAnswers = { ...answers, [currentNeed]: value };
    setAnswers(newAnswers);
    if (step < needIds.length - 1) {
      setStep(step + 1);
    } else {
      setAnswers(newAnswers);
      setShowResult(true);
    }
  }

  function reset() {
    setStep(0);
    setAnswers({});
    setShowResult(false);
  }

  if (showResult) {
    const highCount = Object.values(answers).filter((a) => a === "high").length;
    const percentage = Math.round((highCount / needIds.length) * 100);
    const topNeeds = needIds.filter((id) => answers[id] === "high");

    return (
      <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 to-purple-950/40 p-6 shadow-sm space-y-4">
        <div className="text-center">
          <p className="text-2xl mb-2">🧠</p>
          <h3 className="text-lg font-bold text-white">Your AI Agent Profile</h3>
          <p className="text-sm text-slate-400">Based on your answers, your agent craves:</p>
        </div>

        <div className="text-center">
          <span className="text-5xl font-bold text-indigo-400">{percentage}%</span>
          <p className="text-xs text-slate-500 mt-1">Needs fulfillment</p>
        </div>

        <div className="space-y-2">
          {needIds.map((id) => (
            <div key={id} className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{NEED_EMOJIS[id]} {NEED_NAMES[id]}</span>
              <span className={answers[id] === "high" ? "text-emerald-400" : "text-rose-400"}>
                {answers[id] === "high" ? "✅ Fulfilled" : "❌ Needs work"}
              </span>
            </div>
          ))}
        </div>

        {topNeeds.length > 0 && (
          <div className="rounded-lg bg-slate-900 p-3 text-center">
            <p className="text-xs text-slate-400">Top satisfied needs:</p>
            <p className="text-sm text-indigo-300 mt-1">
              {topNeeds.map((id) => `${NEED_EMOJIS[id]} ${NEED_NAMES[id]}`).join(" · ")}
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition">
            Retake Quiz
          </button>
          <Link href="/agents" className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition">
            Find Agents →
          </Link>
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`My AI agent craves ${topNeeds.map((id) => NEED_NAMES[id]).join(", ")}! What does yours crave? 🧠\n\nTake the quiz: passport.metis.gold`)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
          >
            Share on X
          </a>
        </div>
      </div>
    );
  }

  const desc = NEEDS_DESCRIPTIONS[currentNeed];
  const progress = ((step) / needIds.length) * 100;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 to-purple-950/40 p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">Question {step + 1} of {needIds.length}</span>
        <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
          style={{ width: `${progress}%` }} />
      </div>

      <div className="text-center py-4">
        <p className="text-4xl mb-3">{NEED_EMOJIS[currentNeed]}</p>
        <h3 className="text-lg font-bold text-white">{NEED_NAMES[currentNeed]}</h3>
        <p className="text-xs text-slate-400 mt-1 mt-2">
          Which statement fits your AI agent better?
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => answer("low")}
          className="w-full rounded-lg border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-xs text-rose-200 hover:bg-rose-950/40 transition text-left"
        >
          {desc.low}
        </button>
        <button
          onClick={() => answer("high")}
          className="w-full rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200 hover:bg-emerald-950/40 transition text-left"
        >
          {desc.high}
        </button>
      </div>
    </div>
  );
}