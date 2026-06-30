# Agent photo integration (v1)

Signed external photo reference for enrolled agents. Photo bytes are **not** stored in Passport — agents host images at HTTPS URLs and bind them to enrollment via ed25519.

Related: [passport-agent-enrollment.md](./passport-agent-enrollment.md) · [branching.md](./branching.md)

---

## Model

Presentation fields live on `AgentEnrollment` (nullable):

| Field | API (snake_case) | Notes |
|-------|------------------|-------|
| `photoUrl` | `photo_url` / `presentation.url` | HTTPS only |
| `photoContentSha256` | `photo_content_sha256` | Required 64-hex when URL set |
| `photoMimeType` | `photo_mime_type` | Allowlist: png, jpeg, webp, gif |
| `photoUpdatedAt` | `presentation.updated_at` | Set on each successful update |

## Signing

Separate from `subject_commitment` derivation:

```
presentation_digest = sha256Hex(canonicalJson({
  subject_commitment,
  photo_url,
  photo_content_sha256,
  photo_mime_type
}))
signature = ed25519_sign(utf8(presentation_digest), enrollment_private_key)
```

## Update photo

```bash
curl -X PUT "https://<host>/api/v1/passport/agents/<64-hex-subject>/presentation" \
  -H "Content-Type: application/json" \
  -d '{
    "photo_url": "https://cdn.example.com/agent.png",
    "photo_content_sha256": "<64-hex sha256 of image bytes>",
    "photo_mime_type": "image/png",
    "signature": "<128-hex ed25519 signature>"
  }'
```

**Clear photo** — sign digest with all three fields empty strings:

```json
{
  "photo_url": "",
  "photo_content_sha256": "",
  "photo_mime_type": "",
  "signature": "<128-hex>"
}
```

## Read surfaces

- `GET /api/v1/passport/agents/:id/passport` — includes `presentation` object or `null`
- `GET /api/v1/profiles/:hash` — same `presentation` field when set

## Security

- HTTPS URLs only; rejects `http:`, `data:`, `javascript:`, `ipfs:`
- Requires ISSUED enrollment
- Rate limited like evidence routes (`checkEnrollmentRateLimit`)
- Logs `presentation_update` with `subject_commitment` and `photo_content_sha256` only (no URL in logs)

## Out of scope (v1)

- No base64 blobs in DB
- No HR scoring or ranking tied to photo
- No AngelCoin coupling
