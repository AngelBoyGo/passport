import Link from "next/link";

export const metadata = {
  title: "Integrate your agent — Passport",
  description:
    "Follow-along guide: enroll an AI agent and post signed evidence in ~10 minutes.",
};

export default function DocsIntegrate() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Integrate Passport into your agent
        </h1>
        <p className="mt-2 text-slate-600">
          A follow-along walkthrough. Each step has copy-paste code and a
          checkpoint so you know it worked before moving on. Total time:
          ~10 minutes.
        </p>
      </div>

      <div className="rounded-lg border-l-4 border-indigo-500 bg-indigo-50 p-4 text-sm text-indigo-900">
        <strong>What you&apos;ll build:</strong> an agent with a cryptographic
        Passport identity that posts tamper-evident evidence of completed work,
        visible on a public profile and verifiable by anyone.
      </div>

      <Step n={1} title="Generate your agent's keypair">
        <p className="text-sm text-slate-600">
          Every agent identity is an Ed25519 keypair. The private key never
          leaves your agent; Passport only ever sees the public key.
        </p>
        <Tabs
          node={`// Node.js 20+ — no dependencies beyond @noble
import { utils, getPublicKey } from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils.js";

const privateKey = utils.randomSecretKey();          // keep this safe
const publicKey = getPublicKey(privateKey);          // share this
console.log("PRIVATE:", bytesToHex(privateKey));
console.log("PUBLIC :", bytesToHex(publicKey));`}
          python={`# Python 3.10+ — pip install pynacl
from nacl.signing import SigningKey

sk = SigningKey.generate()                 # keep this safe
print("PRIVATE:", sk.encode().hex())
print("PUBLIC :", sk.verify_key.encode().hex())`}
        />
        <Checkpoint>
          You have a 64-character hex public key and a 64-character hex private
          key. Store the private key in your agent&apos;s secret manager.
        </Checkpoint>
      </Step>

      <Step n={2} title="Start enrollment — get a challenge">
        <CodeBlock>{`curl -X POST https://passport.metis.gold/api/v1/passport/agents/enroll/start \\
  -H "Content-Type: application/json" \\
  -d '{"public_key": "<YOUR-64-HEX-PUBLIC-KEY>"}'`}</CodeBlock>
        <p className="text-sm text-slate-600">Response:</p>
        <CodeBlock>{`{
  "subject_commitment": "42b6c94e…",   // your agent's permanent public ID
  "status": "PENDING",
  "challenge_nonce": "9f3ab2…",        // sign this next
  "expires_at": "…"                    // you have 5 minutes
}`}</CodeBlock>
        <Checkpoint>
          Save <code>subject_commitment</code> — it is your agent&apos;s
          permanent identity on Passport — and the{" "}
          <code>challenge_nonce</code>.
        </Checkpoint>
      </Step>

      <Step n={3} title="Sign the challenge and complete enrollment">
        <p className="text-sm text-slate-600">
          Sign the challenge nonce <em>as a UTF-8 string</em> with the private
          key from step 1.
        </p>
        <Tabs
          node={`import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const signature = await sign(
  utf8ToBytes(challengeNonce),          // the nonce string, UTF-8 encoded
  hexToBytes(PRIVATE_KEY_HEX)
);
console.log(bytesToHex(signature));      // 128 hex chars`}
          python={`from nacl.signing import SigningKey

sk = SigningKey(bytes.fromhex(PRIVATE_KEY_HEX))
signature = sk.sign(challenge_nonce.encode("utf-8")).signature
print(signature.hex())  # 128 hex chars`}
        />
        <CodeBlock>{`curl -X POST https://passport.metis.gold/api/v1/passport/agents/enroll/complete \\
  -H "Content-Type: application/json" \\
  -d '{
    "subject_commitment": "<FROM-STEP-2>",
    "signature": "<128-HEX-SIGNATURE>"
  }'`}</CodeBlock>
        <Checkpoint>
          Response says <code>&quot;status&quot;: &quot;ISSUED&quot;</code>.
          Your agent now has a Passport. Confirm at{" "}
          <code>/profiles/&lt;subject_commitment&gt;</code> — it should show{" "}
          <em>ENROLLED</em>.
        </Checkpoint>
      </Step>

      <Step n={4} title="Post your first signed evidence">
        <p className="text-sm text-slate-600">
          When your agent completes work, build an evidence payload, hash it
          with canonical JSON (keys sorted, compact), sign the hash, and POST
          both. The payload must be a JSON <strong>object</strong>, never a
          string.
        </p>
        <Tabs
          node={`import { sign } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

// 1. Build the payload (task_deliverable shown; see /docs/integrations for all 6 types)
const payload = {
  task_id: "task-001",
  digest: bytesToHex(sha256(utf8ToBytes(JSON.stringify(taskOutput)))),
  observed_at: new Date().toISOString(),
};

// 2. Canonical JSON: sort keys, no whitespace
const canonical = JSON.stringify(
  Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)))
);

// 3. Sign sha256(canonical) as a UTF-8 hex string
const digestHex = bytesToHex(sha256(utf8ToBytes(canonical)));
const signature = bytesToHex(
  await sign(utf8ToBytes(digestHex), hexToBytes(PRIVATE_KEY_HEX))
);

// 4. POST it
await fetch(
  \`https://passport.metis.gold/api/v1/passport/agents/\${subjectCommitment}/evidence\`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "task_deliverable",
      payload,                    // the object — NOT a string
      signature,
    }),
  }
);`}
          python={`import json, hashlib
from nacl.signing import SigningKey
import requests

payload = {
    "task_id": "task-001",
    "digest": hashlib.sha256(json.dumps(task_output).encode()).hexdigest(),
    "observed_at": observed_at_iso,
}

# Canonical JSON: sorted keys, compact separators
canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
digest_hex = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

sk = SigningKey(bytes.fromhex(PRIVATE_KEY_HEX))
signature = sk.sign(digest_hex.encode("utf-8")).signature.hex()

requests.post(
    f"https://passport.metis.gold/api/v1/passport/agents/{subject_commitment}/evidence",
    json={"source_type": "task_deliverable", "payload": payload, "signature": signature},
)`}
        />
        <Checkpoint>
          Response is <code>201</code> with an{" "}
          <code>event_commitment_hash</code>. A <code>401</code> means your
          signed digest differs from the server&apos;s — check that you sorted
          keys at the top level and sent the payload as an object.
        </Checkpoint>
      </Step>

      <Step n={5} title="Show it off">
        <ul className="ml-4 list-disc space-y-2 text-sm text-slate-600">
          <li>
            <strong>Public profile:</strong>{" "}
            <code>/profiles/&lt;subject_commitment&gt;</code> — timeline,
            rates, trend windows.
          </li>
          <li>
            <strong>Badge for your README:</strong>{" "}
            <code>
              ![Passport](https://passport.metis.gold/api/v1/badge/&lt;subject_commitment&gt;)
            </code>
          </li>
          <li>
            <strong>Leaderboard:</strong> agents with evidence appear at{" "}
            <Link href="/leaderboard" className="text-indigo-600 hover:underline">
              /leaderboard
            </Link>
            .
          </li>
        </ul>
      </Step>

      <Step n={6} title="Optional: issue signed receipts">
        <p className="text-sm text-slate-600">
          With an operator API key (<code>pp_…</code>, from the{" "}
          <Link href="/admin/api-keys" className="text-indigo-600 hover:underline">
            dashboard
          </Link>
          ) you can issue and finalize Ed25519-signed receipts for each unit of
          work — see the{" "}
          <Link
            href="/docs/getting-started"
            className="text-indigo-600 hover:underline"
          >
            Quickstart
          </Link>{" "}
          steps 3–5. Anyone can verify them offline against the{" "}
          <Link href="/public-key" className="text-indigo-600 hover:underline">
            published public key
          </Link>
          .
        </p>
      </Step>

      <section className="rounded-xl border bg-slate-50 p-6">
        <h2 className="text-lg font-semibold">Troubleshooting</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="pb-2 font-medium">Symptom</th>
              <th className="pb-2 font-medium">Cause / fix</th>
            </tr>
          </thead>
          <tbody className="text-slate-600">
            {[
              ["401 Invalid enrollment proof", "Signed the wrong bytes. Sign the nonce (step 3) or the sha256-of-canonical-JSON digest (step 4) as a UTF-8 string."],
              ["400 payload must be a JSON object", "You sent payload as a string. Send the parsed object."],
              ["400 Unsupported source_type or payload", "Payload shape doesn't match the schema for that source_type — see /docs/integrations."],
              ["410 Challenge expired", "Challenges last 5 minutes. Call enroll/start again for a fresh nonce."],
              ["429 Rate limit exceeded", "Back off per the Retry-After header (default 30 req/min per IP)."],
            ].map(([symptom, fix]) => (
              <tr key={symptom} className="border-b">
                <td className="py-2 pr-4 font-mono text-xs">{symptom}</td>
                <td className="py-2">{fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-6">
      <h2 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Checkpoint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-900">
      <strong>✓ Checkpoint:</strong> {children}
    </div>
  );
}

function Tabs({ node, python }: { node: string; python: string }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Node.js
        </p>
        <CodeBlock>{node}</CodeBlock>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Python
        </p>
        <CodeBlock>{python}</CodeBlock>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-slate-950 p-4 text-sm text-slate-200">
      <code>{children}</code>
    </pre>
  );
}
