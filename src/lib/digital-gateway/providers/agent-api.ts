/**
 * Internal Agent-API direct-settlement adapter — Phase 18.
 * Used by the authenticated agent on-ramp: no external provider HMAC because the caller
 * is already key-authenticated and amounts are pre-validated by the route.
 */

import {
  MoneyProvider,
  parseStandard,
  verifyStandardHook,
} from "./contract";

export const AgentApiProvider: MoneyProvider = {
  name: "agent_api",
  parseCallback(payload) {
    const { externalRef, xofAmount, raw } = parseStandard(payload, "external_reference", "amount");
    if (!externalRef || xofAmount <= 0) {
      throw new Error("Agent on-ramp missing external_reference or amount");
    }
    return { externalRef, xofAmount, raw };
  },
  verifyCallbackSignature(payload, secret) {
    return verifyStandardHook(payload, secret);
  },
};