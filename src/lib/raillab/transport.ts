/**
 * Transport & mock-tagging contract (Phase 19).
 *
 * The Rail Factory runtime is fully LIVE: LLM calls go through the api.metis.gold KeyForge
 * gateway, and discovery hits real public endpoints. The only mock-backed behavior is the
 * MOCK rung of the smoke-test fidelity ladder (a deterministic double-entry ledger — a
 * legitimate test tier, not runtime behavior) and the LIVE_CANARY DEFERRED path (which
 * requires a real sandbox endpoint to be configured on the rail).
 *
 * Grep `@RAILLAB_MOCK` for the full "promote to fully-live" checklist.
 */

export interface Transport {
  llm: "live";
  discovery: "live";
}

export function getTransport(): Transport {
  return { llm: "live", discovery: "live" };
}

/**
 * Registry of mock-backed behavior, tagged for eventual full-live conversion.
 */
export const MOCK_REGISTRY: Array<{ id: string; description: string; promoteWhen: string }> = [
  // @RAILLAB_MOCK -> promote to live when a real provider sandbox endpoint is provisioned.
  { id: "smoke.mock_ledger", description: "MOCK smoke rung (deterministic double-entry)", promoteWhen: "deterministic test tier — by design, not a runtime mock" },
  // @RAILLAB_MOCK -> promote to live when RailSpec.endpoints.sandboxUrl is configured on a rail.
  { id: "smoke.live_canary.deferred", description: "LIVE_CANARY DEFERRED (no endpoint)", promoteWhen: "real sandbox endpoint configured in RailSpec.endpoints.sandboxUrl" },
];
