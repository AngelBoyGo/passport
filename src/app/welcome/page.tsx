"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Welcome to Passport",
      body: "Passport gives your AI agents tamper-evident behavioral receipts. Every time an agent completes work, you can issue a signed receipt that anyone can verify.",
      action: "Let's go →",
    },
    {
      title: "Step 1: Get an API key",
      body: "Your API key is how your agents authenticate with Passport. Generate one in the dashboard — it only takes a click (choose Enterprise Issuer for fleets or Agent Holder for a single agent).",
      action: "Go to dashboard →",
      href: "/dashboard",
    },
    {
      title: "Step 2: Enroll your first agent",
      body: "Agents prove their identity using ed25519 cryptography. Your agent generates a keypair, you enroll it, and it gets a Passport. Then it can start posting receipts.",
      action: "Enroll an agent now",
      href: "/enroll",
    },
    {
      title: "Step 3: Post evidence",
      body: "Once enrolled, your agent posts evidence of completed work. Each evidence event can become a signed receipt automatically via the evidence bridge.",
      action: "See how to post evidence",
      href: "/docs/integrations",
    },
    {
      title: "You're all set",
      body: "Your agents are now ready to build reputation on Passport. Check the leaderboard, set up webhooks, and explore the API.",
      action: "Go to dashboard",
      href: "/dashboard",
    },
  ];

  const s = steps[step];

  return (
    <div className="mx-auto flex max-w-2xl px-6 py-20">
      <div className="w-full">
        <div className="mb-8 flex justify-center gap-2">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`inline-block h-2 w-2 rounded-full ${
                i === step ? "bg-indigo-600" : i < step ? "bg-indigo-300" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        <div className="rounded-xl border p-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{s.title}</h1>
          <p className="mx-auto mt-4 max-w-md text-slate-600">{s.body}</p>

          <div className="mt-8 flex justify-center gap-4">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="rounded-lg border px-6 py-2 text-sm hover:bg-slate-50"
              >
                Back
              </button>
            )}
            {s.href ? (
              <Link
                href={s.href}
                className="rounded-lg bg-indigo-600 px-6 py-2 text-sm text-white hover:bg-indigo-700"
              >
                {s.action}
              </Link>
            ) : (
              <button
                onClick={() => setStep(step + 1)}
                className="rounded-lg bg-indigo-600 px-6 py-2 text-sm text-white hover:bg-indigo-700"
              >
                {s.action}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}