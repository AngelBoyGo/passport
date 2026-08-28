"use client";

import { useEffect, useState } from "react";

interface ConfettiProps {
  trigger: boolean;
  type?: "celebration" | "achievement" | "chest";
  onComplete?: () => void;
}

/**
 * Dopamine confetti overlay — fires on tier upgrades, chest openings, badge unlocks.
 * Psychology: variable rewards + unexpected celebration = dopamine spike.
 * Colors: gold (achievement), purple (rare), green (success).
 */
export function ConfettiEffect({ trigger, type = "celebration", onComplete }: ConfettiProps) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; color: string; delay: number; size: number }>>([]);

  useEffect(() => {
    if (!trigger) return;

    const colors = type === "achievement"
      ? ["#f59e0b", "#6366f1", "#22c55e", "#ef4444", "#ec4899"]
      : type === "chest"
        ? ["#f59e0b", "#d97706", "#fbbf24", "#fcd34d"]
        : ["#22c55e", "#3b82f6", "#6366f1", "#f59e0b"];

    const newParticles = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.3,
      size: 4 + Math.random() * 8,
    }));

    setParticles(newParticles);

    const timer = setTimeout(() => {
      setParticles([]);
      onComplete?.();
    }, 2000);

    return () => clearTimeout(timer);
  }, [trigger, type, onComplete]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-float-up"
          style={{
            left: `${p.x}%`,
            bottom: "-10px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${1.5 + Math.random()}s`,
            opacity: 0.9,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes float-up {
          0% { transform: translateY(0) rotate(0deg) scale(0); opacity: 0; }
          10% { opacity: 1; transform: translateY(-20vh) rotate(180deg) scale(1); }
          100% { transform: translateY(-110vh) rotate(720deg) scale(0.5); opacity: 0; }
        }
        .animate-float-up {
          animation: float-up ease-out forwards;
        }
      `}</style>
    </div>
  );
}