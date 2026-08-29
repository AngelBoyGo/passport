/**
 * Passport Anchor — GitHub Action
 *
 * Posts evidence to Passport on every commit.
 * The agent badge auto-updates with reputation score + tier.
 * Viral: every PR, every commit, every repo shows the badge.
 */
import * as core from "@actions/core";
import * as github from "@actions/github";

async function run() {
  try {
    const token = core.getInput("passport-token", { required: true });
    const commitment = core.getInput("agent-commitment", { required: true });
    const baseUrl = core.getInput("passport-url") || "https://passport.metis.gold";

    const { sha, ref, payload } = github.context;

    const evidencePayload = {
      task_id: sha,
      digest: sha,
      observed_at: new Date().toISOString(),
      ref,
      repository: payload.repository?.full_name,
      message: payload.head_commit?.message?.slice(0, 200),
      author: payload.head_commit?.author?.name,
    };

    const canonical = JSON.stringify(Object.fromEntries(Object.entries(evidencePayload).sort(([a], [b]) => a < b ? -1 : 1)));
    const digestHex = await sha256Hex(canonical);

    // We don't have the agent's private key in CI, so we use the service token
    // The service token acts as the operator — the evidence is attributed to the operator.
    const res = await fetch(`${baseUrl}/api/v1/passport/agents/${commitment}/evidence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        source_type: "github_commit_payload",
        payload: evidencePayload,
        signature: "0".repeat(128), // Service-authed; operator signs
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      core.setFailed(`Passport anchor failed: ${res.status} ${err}`);
      return;
    }

    const result = await res.json();
    core.setOutput("event_commitment_hash", result.event_commitment_hash);
    core.info(`✅ Evidence anchored: ${result.event_commitment_hash}`);
    core.info(`🔗 ${baseUrl}/profiles/${commitment}`);
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

run();