/**
 * Orange Money (Orange CI / Orange Mali) adapter — Phase 18.
 */

import {
  MoneyProvider,
  parseStandard,
  verifyStandardHook,
} from "./contract";

export const OrangeMoneyProvider: MoneyProvider = {
  name: "orangemoney",
  parseCallback(payload) {
    const { externalRef, xofAmount, raw } = parseStandard(payload, "transaction_id", "amount");
    if (!externalRef || xofAmount <= 0) {
      throw new Error("Orange Money callback missing transaction_id or amount");
    }
    return { externalRef, xofAmount, raw };
  },
  verifyCallbackSignature(payload, secret) {
    return verifyStandardHook(payload, secret);
  },
};