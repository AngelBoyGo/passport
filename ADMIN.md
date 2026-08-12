# Passport Executive Command Center

The `/admin` route is the developer/CEO operator console. It is protected by the
Passport `session_token` cookie plus the production `ADMIN_OPERATOR_EMAILS`
allowlist, and is intentionally separate from the public
verification portal.

## Current Modules

Modules are registered in `src/app/admin/config/tabs.ts`. The current registry is:

- Command Center: system pulse, receipts, issued agents, evidence, and health.
- Trust Operations: reserved for enrollment, evidence, receipt, and profile drilldowns.
- Economy: reserved for credits, escrow, marketplace, and slashing drilldowns.
- Reliability: health checkpoints and dependency readiness.

To add a module in 5 minutes:

1. Add a typed entry to `ADMIN_TABS`.
2. Add the tab's data to `src/app/api/admin/overview/route.ts` or create a focused `/api/admin/<module>` provider.
3. Render the module in `ExecutiveDashboard` using shared `Panel`, `Metric`, `Posture`, and `Status` primitives.
4. Make important values links to an existing public or admin route, preserving filters in the query string.
5. Add a focused route or component test and run `npx tsc --noEmit && npm run build`.

## Backend Boundaries

- `GET /api/admin/overview`: session-authenticated, operator-scoped executive snapshot.
- `POST /api/admin/copilot/context`: validates the operator session and returns a safe context envelope for a future LLM provider.

Admin endpoints must authenticate the session cookie. Do not accept a raw API key
from the browser for dashboard access. API keys remain for machine-to-machine
Passport API calls.

Set `ADMIN_OPERATOR_EMAILS` in Render to the exact CEO/developer email address
allowed to access the private console. In production, an empty allowlist denies
executive access rather than opening the dashboard to every signed-in operator.

## Copilot Safety

Passport currently captures context but does not ship an LLM provider. When one is
added, keep read tools separate from mutation tools. Every mutation must validate
operator ownership, require explicit confirmation in the UI, and write a durable
audit event before execution.

The initial context envelope contains the active tab, operator role, metric
summary, health state, and recent activity. Never include private signing keys,
session tokens, raw API keys, or unmasked evidence payloads.

## Observability Notes

Passport currently emits structured JSON events to stdout through
`src/lib/observability/logger.ts`. Events include request IDs where routes use the
observability wrapper, but logs are not yet persisted or queryable in the admin UI.
The next reliability slice should add a durable redacted audit/event store and a
retention policy before building live log search.
