# passport-sdk (Python)

> Free & open-source (MIT). Stdlib-only Python SDK for Passport — issue and verify
> Ed25519-signed behavioral receipts for AI agents and gate LangGraph workflows.

## Install

```bash
pip install passport-sdk   # or copy this package into your project (stdlib only, no deps)
```

## Quickstart

```python
from passport_sdk import PassportClient

p = PassportClient(api_key="pp_…", base_url="https://passport.metis.gold")

receipt = p.issue_receipt(
    agent_id="agent_fulfillment_1",
    receipt_type="competence",
    input_digest="<sha256 hex>",
    authority_scope="fulfillment.example.com",
    expiry="2026-08-01T00:00:00.000Z",
)
print(receipt["receipt_id"])

p.finalize_receipt(receipt["receipt_id"], status="success", output_hash="<sha256 hex>")
```

Verification is public and unauthenticated:

```python
manifest = p.public_manifest(receipt["receipt_id"])  # GET /receipts/:id/public-manifest
```

## LangGraph gate integration

Before a node runs, call `p.query_gate(...)` to confirm the workflow's operator is allowed
to invoke in the target domain (`FINANCIAL_CLEARING`, `CUSTOMER_SUPPORT`, …).

## Docs

- <https://passport.metis.gold/docs/api-reference>
- <https://passport.metis.gold/llms.txt>
- TypeScript SDK: `@passport7/sdk` on npm