/**
 * Internal USSD direct-settlement adapter — Phase 18.
 * Used by the USSD BUY confirm path: no external provider HMAC is required because the
 * caller is the authenticated USSD gateway itself, and amounts are pre-validated upstream.
 */

import {
  MoneyProvider,
  parseStandard,
  verifyStandardHook,
} from "./contract";

export const UssdProvider: MoneyProvider = {
  name: "ussd",
  parseCallback(payload) {
    const { externalRef, xofAmount, raw } = parseStandard(payload, "external_reference", "amount");
    if (!externalRef || xofAmount <= 0) {
      throw new Error("USSD settlement missing external_reference or amount");
    }
    return { externalRef, xofAmount, raw };
  },
  verifyCallbackSignature(payload, secret) {
    return verifyStandardHook(payload, secret);
  },
};