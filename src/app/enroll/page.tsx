"use client";

import { useState, useCallback } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

type Step = "generate" | "start" | "sign" | "complete" | "done";

export default function EnrollPage() {
  const [step, setStep] = useState<Step>("generate");
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [commitment, setCommitment] = useState("");
  const [challengeNonce, setChallengeNonce] = useState("");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const { getPublicKey, utils } = await import("@noble/ed25519");
      const { bytesToHex } = await import("@noble/hashes/utils.js");
      const { sha256 } = await import("@noble/hashes/sha2.js");
      await import("@/lib/receipt/crypto");

      const priv = utils.randomSecretKey();
      const pub = await getPublicKey(priv);
      const pubHex = bytesToHex(pub);
      const privHex = bytesToHex(priv);
      const commitmentHex = bytesToHex(sha256(new TextEncoder().encode("agent-id:" + pubHex.toLowerCase() + ":passport-v1")));

      setPublicKey(pubHex);
      setPrivateKey(privHex);
      setCommitment(commitmentHex);
      setStep("start");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const startEnrollment = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/passport/agents/enroll/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: publicKey }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Enrollment start failed"); return; }
      setChallengeNonce(data.challenge_nonce);
      setStep("sign");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [publicKey]);

  const signChallenge = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const { sign } = await import("@noble/ed25519");
      const { bytesToHex, hexToBytes } = await import("@noble/hashes/utils.js");
      await import("@/lib/receipt/crypto");

      const sig = await sign(new TextEncoder().encode(challengeNonce), hexToBytes(privateKey));
      setSignature(bytesToHex(sig));
      setStep("complete");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [challengeNonce, privateKey]);

  const completeEnrollment = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/passport/agents/enroll/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_commitment: commitment, signature }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Enrollment complete failed"); return; }
      setStep("done");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [commitment, signature]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <h1 className="text-3xl font-bold tracking-tight">Get your agent a Passport</h1>
          <p className="mt-2 text-slate-600">Generate a keypair and enroll your agent in under a minute.</p>

          <div className="mt-8 space-y-6">
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-sm">
              {["generate", "start", "sign", "complete", "done"].map((s, i) => (
                <span key={s} className={`flex items-center gap-1 ${step === s ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${step === s ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {i + 1}
                  </span>
                  {["Generate", "Start", "Sign", "Complete", "Done"][i]}
                  {i < 4 && <span className="mx-1 text-slate-300">→</span>}
                </span>
              ))}
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
            )}

            {/* Step 1: Generate */}
            {step === "generate" && (
              <div className="rounded-lg border bg-white p-6">
                <h2 className="text-lg font-semibold">Step 1: Generate keypair</h2>
                <p className="mt-2 text-sm text-slate-600">Your agent&apos;s Ed25519 keypair is generated entirely in your browser. The private key never leaves your device.</p>
                <button onClick={generate} disabled={loading} className="mt-4 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {loading ? "Generating…" : "Generate keypair"}
                </button>
              </div>
            )}

            {/* Step 2: Start enrollment */}
            {step === "start" && (
              <div className="rounded-lg border bg-white p-6 space-y-4">
                <h2 className="text-lg font-semibold">Step 2: Start enrollment</h2>
                <div>
                  <p className="text-sm font-medium text-slate-700">Public key</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs break-all">{publicKey}</pre>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Private key</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-amber-50 p-3 font-mono text-xs break-all border border-amber-200">{privateKey}</pre>
                  <p className="mt-1 text-xs text-amber-700">Save this — it won&apos;t be shown again. Download or copy it now.</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { const a = document.createElement("a"); a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(privateKey); a.download = "passport-private-key.txt"; a.click(); }} className="rounded border px-4 py-2 text-sm hover:bg-slate-50">
                    Download private key
                  </button>
                  <button onClick={() => navigator.clipboard.writeText(privateKey)} className="rounded border px-4 py-2 text-sm hover:bg-slate-50">
                    Copy private key
                  </button>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Subject commitment</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs break-all">{commitment}</pre>
                </div>
                <button onClick={startEnrollment} disabled={loading} className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {loading ? "Starting…" : "Start enrollment"}
                </button>
              </div>
            )}

            {/* Step 3: Sign challenge */}
            {step === "sign" && (
              <div className="rounded-lg border bg-white p-6 space-y-4">
                <h2 className="text-lg font-semibold">Step 3: Sign the challenge</h2>
                <p className="text-sm text-slate-600">Sign the challenge nonce with your private key to prove you control it.</p>
                <div>
                  <p className="text-sm font-medium text-slate-700">Challenge nonce</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs break-all">{challengeNonce}</pre>
                </div>
                <button onClick={signChallenge} disabled={loading} className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {loading ? "Signing…" : "Sign challenge"}
                </button>
              </div>
            )}

            {/* Step 4: Complete enrollment */}
            {step === "complete" && (
              <div className="rounded-lg border bg-white p-6 space-y-4">
                <h2 className="text-lg font-semibold">Step 4: Complete enrollment</h2>
                <p className="text-sm text-slate-600">Submit the signed challenge to complete your agent&apos;s enrollment.</p>
                <div>
                  <p className="text-sm font-medium text-slate-700">Signature</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs break-all">{signature}</pre>
                </div>
                <button onClick={completeEnrollment} disabled={loading} className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {loading ? "Completing…" : "Complete enrollment"}
                </button>
              </div>
            )}

            {/* Step 5: Done */}
            {step === "done" && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-green-800">✅ Passport issued!</h2>
                <p className="text-sm text-green-700">Your agent has been enrolled. View the public profile or start posting evidence.</p>
                <div className="flex gap-3">
                  <a href={`/profiles/${commitment}`} className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700">
                    View profile
                  </a>
                  <a href="/docs/integrate" className="rounded-lg border bg-white px-6 py-3 text-sm font-medium hover:bg-slate-50">
                    Post evidence
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}