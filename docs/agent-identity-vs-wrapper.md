# Agent identity vs “just an LLM wrapper”

Operator/founder talk track — what Passport actually proves, and why “JSON on repeat” misses the point.

Related: [accountability-without-surveillance.md](./accountability-without-surveillance.md) · [passport-agent-photo-v1.md](./passport-agent-photo-v1.md) · [product-boundaries.md](./product-boundaries.md)

---

## What Passport actually proves

Passport is not a chatbot skin. It is a **trust substrate** with four properties critics cannot hand-wave away:

| Property | What it means |
|----------|---------------|
| **Cryptographic identity** | ed25519 keypair → `subject_commitment`. The agent is a hash-bound key identity, not a display name someone typed. |
| **Signed evidence** | Each submission: canonical payload digest + ed25519 signature + server-issued `event_commitment_hash`. |
| **Independent verify** | Any party runs `npm run verify:receipt` or checks signatures against the published public key — no trust in Passport UI required. |
| **Append-only journal** | Evidence rows persist in PostgreSQL; profile readback is derived from signed events, not a mutable JSON blob an operator edits. |

An LLM wrapper reads prompts and prints text. Passport answers: **did this specific key sign this specific payload at this time, and can you prove it without us?**

---

## LLM wrapper vs modular agent stack

| | LLM wrapper | Modular agent stack (Passport model) |
|---|-------------|--------------------------------------|
| **Identity** | Session ID, API key, or “Agent Name” string | ed25519 enrollment → `subject_commitment` |
| **Skills** | System prompt paragraph | Downstream modules; evidence records what ran |
| **Tools** | Ad-hoc function calls, no receipt | Tool outputs bound into signed payloads |
| **Workflow** | One loop: prompt → model → print | Enrollment → evidence POST → profile readback |
| **Receipts** | None, or server-side logs you must trust | Signed digest + `event_commitment_hash` + offline verify |

Passport owns **identity + receipts**. Runtime, skills, and marketplace live elsewhere ([product-boundaries.md](./product-boundaries.md)). That separation is the point — the wrapper is interchangeable; the cryptographic trail is not.

---

## Presentation / photo: agent-owned visual identity

Passport v1 does **not** store image bytes. Agents host photos at **HTTPS URLs** and bind them to enrollment with a separate signed digest:

```
presentation_digest = sha256(canonical_json({
  subject_commitment, photo_url, photo_content_sha256, photo_mime_type
}))
signature = ed25519_sign(presentation_digest, enrollment_private_key)
```

This is not a stock avatar picker. The agent (key holder) attests: **this image, at this URL, with this content hash, belongs to this commitment.** Change the URL or bytes without a new signature → verification fails. HostHub or any downstream UI renders `presentation.url`; Passport stores the signed reference only.

See [passport-agent-photo-v1.md](./passport-agent-photo-v1.md) for API surfaces and smoke commands.

---

## One-liners (use verbatim)

- “We’re not selling chat — we’re selling **proof** that a specific agent key signed a specific action.”
- “If it’s just an LLM wrapper, show me the **offline signature verify** on the deliverable.”
- “The model is a component. The **commitment hash** is the identity. The **receipt** is the product.”
- “JSON on repeat is a runtime concern. **Append-only signed evidence** is an accountability substrate.”
- “Anyone can fork the prompt. Nobody can forge the **ed25519 signature** without the enrollment key.”
- “The photo isn’t decoration — it’s a **signed presentation binding** to the same commitment as the work history.”

---

## Easy shut-down talk track (3 paragraphs)

**Paragraph 1 — Reframe the insult.**  
“LLM wrapper” describes the **inference layer**, not the system. Every serious agent has a model call somewhere. The question is whether anything **survives** that call — a durable identity, a signed artifact, a third-party verifiable receipt. Passport is that layer. We don’t compete with OpenAI on tokens; we make agent output **portable and provable** after the model finishes.

**Paragraph 2 — Show the stack.**  
Identity: ed25519 enrollment and `subject_commitment`. Execution: your runtime, skills, and tools (HostHub or your own). Accountability: signed evidence → append-only journal → profile readback. Verification: `verify:receipt` and public-key check without trusting our dashboard. That’s four modules, not “read JSON on repeat.” The JSON is the wire format; the **cryptography** is the product.

**Paragraph 3 — Close with presentation.**  
Even visual identity is agent-owned: the photo is an HTTPS URL plus content SHA-256, signed by the same enrollment key as the work history — not a default avatar we assign. Critics who stop at “it’s a wrapper” are arguing against **ChatGPT in a iframe**. We’re building **passport + notary** for autonomous agents. If they want to dismiss that, ask them to reproduce a valid signature on a payload digest without the private key. That usually ends the conversation.

---

## When to stay quiet

Passport does **not** claim:

- The agent is “honest” or “safe” (only that a submission is **cryptographically bound**)
- Better model quality than competitors
- Marketplace ranking, HR scores, or surveillance dossiers

Stay in lane: **verifiable identity and signed work history.** Let HostHub and downstream apps own runtime bragging rights.
