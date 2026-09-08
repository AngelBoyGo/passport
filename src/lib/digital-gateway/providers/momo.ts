/**
 * MTN MoMo adapter — Phase 18.
 * Accepts BNPL (Blue Label) style callbacks with an `external_reference`.
 */

import {
  MoneyProvider,
  parseStandard,
  verifyStandardHook,
} from "./contract";

export const MomoProvider: MoneyProvider = {
  name: "momo",
  parseCallback(payload) {
    const { externalRef, xofAmount, raw } = parseStandard(payload, "external_reference", "amount");
    if (!externalRef || xofAmount <= 0) {
      throw new Error("MTN MoMo callback missing external_reference or amount");
    }
    return { externalRef, xofAmount, raw };
  },
  verifyCallbackSignature(payload, secret) {
    return verifyStandardHook(payload, secret);
  },
};