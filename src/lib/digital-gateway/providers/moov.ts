/**
 * Moov Money (Benin / Burkina Faso) adapter — Phase 18.
 * Moov reports amounts in centimes (1/100 XOF), so amounts are divided by 100.
 */

import {
  MoneyProvider,
  parseStandard,
  verifyStandardHook,
} from "./contract";

export const MoovMoneyProvider: MoneyProvider = {
  name: "moov",
  parseCallback(payload) {
    const { externalRef, xofAmount, raw } = parseStandard(payload, "order_no", "amount", 100);
    if (!externalRef || xofAmount <= 0) {
      throw new Error("Moov callback missing order_no or amount");
    }
    return { externalRef, xofAmount, raw };
  },
  verifyCallbackSignature(payload, secret) {
    return verifyStandardHook(payload, secret);
  },
};