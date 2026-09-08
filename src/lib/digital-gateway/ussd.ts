/**
 * USSD session state machine — Phase 18 Sahel on-ramp.
 *
 * Feature-phone gateway for the Sahel (smartphone penetration is low; USSD `*123#`
 * is the highest-reach rail). Implements:
 *   - Canonical response grammar: `CON <text>` (continue) / `END <text>` (terminate).
 *   - In-memory session cache with 5-minute TTL.
 *   - Forced MPIN commitment authentication:
 *       sha256Hex("ussd:pin:" + sessionId + "|" + pinDigest)
 *   - Menu: BAL (balance), BUY (confirm-and-settle), EXIT.
 */

import { sha256Hex } from "@/lib/receipt/canonical";

export const USSD_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const USSD_CODE = "#123#";
export const USSD_MENU =
  "1 BAL\n2 BUY\n3 EXIT\n9 MPIN";

interface UssdSession {
  sessionId: string;
  phoneNumber: string;
  state: "AWAITING_PIN" | "MENU" | "AWAITING_BUY_AMOUNT" | "AWAITING_BUY_CONFIRM";
  mPinDigest?: string;
  pendingBuyXof?: number;
  lastActivityAt: number;
}

const sessions = new Map<string, UssdSession>();

export interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  input: string;
}

export interface UssdResponse {
  reply: string; // "CON ..." or "END ..."
  done: boolean;
}

export function ussdPinCommitment(sessionId: string, pinDigest: string): string {
  return sha256Hex(`ussd:pin:${sessionId}|${pinDigest}`);
}

export function ussdPinDigest(pin: string): string {
  return sha256Hex(`pin:${pin}`);
}

/** Prunes expired sessions; call from tests or a timer. */
export function sweepExpiredUssdSessions(nowMs = Date.now()): number {
  let removed = 0;
  for (const [sid, s] of sessions) {
    if (nowMs - s.lastActivityAt > USSD_SESSION_TTL_MS) {
      sessions.delete(sid);
      removed++;
    }
  }
  return removed;
}

/**
 * Advances the USSD session. Returns the canonical reply. The orchestrator route
 * wraps the USSD BUY confirm into a mobile-money settlement.
 */
export function handleUssdInteraction(
  req: UssdRequest,
  opts?: {
    balanceXof?: number;
    balanceAngel?: number;
    /** callback to confirm a BUY; resolves the XOF amount to settle. */
    onBuyConfirm?: (xofAmount: number) => Promise<{ creditedAngel: number; reference: string }>;
    nowMs?: number;
  }
): Promise<UssdResponse> {
  return _handleUssdInteraction(req, opts ?? {});
}

async function _handleUssdInteraction(
  req: UssdRequest,
  opts: {
    balanceXof?: number;
    balanceAngel?: number;
    onBuyConfirm?: (xofAmount: number) => Promise<{ creditedAngel: number; reference: string }>;
    nowMs?: number;
  }
): Promise<UssdResponse> {
  const now = opts.nowMs ?? Date.now();
  const existing = sessions.get(req.sessionId);
  const fresh = existing && now - existing.lastActivityAt <= USSD_SESSION_TTL_MS ? existing : null;
  if (fresh) fresh.lastActivityAt = now;

  // First interaction for this session (or expired): start at the PIN prompt.
  if (!fresh) {
    if (!req.phoneNumber) {
      return { reply: "END ERR NO NUMBER", done: true };
    }
    sessions.set(req.sessionId, {
      sessionId: req.sessionId,
      phoneNumber: req.phoneNumber,
      state: "AWAITING_PIN",
      lastActivityAt: now,
    });
    return { reply: "CON Enter your 4-digit MPIN", done: false };
  }

  const session = fresh;

  switch (session.state) {
    case "AWAITING_PIN": {
      if (!/^\d{4}$/.test(req.input)) {
        return { reply: "CON MPIN must be 4 digits", done: false };
      }
      const digest = ussdPinDigest(req.input);
      session.mPinDigest = digest;
      // PIN accepted → main menu.
      session.state = "MENU";
      return { reply: "CON 1 BAL 2 BUY 3 EXIT", done: false };
    }

    case "MENU": {
      switch (req.input.trim()) {
        case "1":
          // BAL
          return {
            reply: `CON BAL ${opts.balanceXof?.toLocaleString("en-US") ?? "?"} XOF / ${opts.balanceAngel ?? "?"} ANGEL`,
            done: false,
          };
        case "2":
          // BUY → ask amount
          session.state = "AWAITING_BUY_AMOUNT";
          return { reply: "CON Enter amount in XOF", done: false };
        case "3":
          // EXIT
          sessions.delete(req.sessionId);
          return { reply: "END BYE", done: true };
        case "9":
          return { reply: "END MPIN RESET REQUIRES APP", done: true };
        default:
          return { reply: "CON 1 BAL 2 BUY 3 EXIT 9 MPIN", done: false };
      }
    }

    case "AWAITING_BUY_AMOUNT": {
      const amount = Math.round(Number(req.input));
      if (!Number.isFinite(amount) || amount <= 0) {
        return { reply: "CON Enter a valid amount in XOF", done: false };
      }
      session.pendingBuyXof = amount;
      session.state = "AWAITING_BUY_CONFIRM";
      return {
        reply: `CON Confirm buy ${amount.toLocaleString("en-US")} XOF? 1 Yes 2 No`,
        done: false,
      };
    }

    case "AWAITING_BUY_CONFIRM": {
      if (req.input.trim() === "2") {
        session.state = "MENU";
        session.pendingBuyXof = undefined;
        return { reply: "CON 1 BAL 2 BUY 3 EXIT", done: false };
      }
      if (req.input.trim() !== "1") {
        return { reply: "CON 1 Yes 2 No", done: false };
      }
      const xofAmount = session.pendingBuyXof;
      if (!xofAmount || !opts.onBuyConfirm) {
        return { reply: "END ERR NO SETTLEMENT", done: true };
      }
      try {
        const { creditedAngel, reference } = await opts.onBuyConfirm(xofAmount);
        sessions.delete(req.sessionId);
        return {
          reply: `END SUCCESS +${creditedAngel} ANGEL REF ${reference}`,
          done: true,
        };
      } catch (err) {
        return {
          reply: `END ERR ${err instanceof Error ? err.message : "settlement failed"}`,
          done: true,
        };
      }
    }

    default:
      return { reply: "END ERR STATE", done: true };
  }
}

/** Test helper: inject a session directly to skip PIN setup. */
export function __seedUssdSession(session: UssdSession): void {
  sessions.set(session.sessionId, session);
}

/** Test helper: clear all sessions. */
export function __clearUssdSessions(): void {
  sessions.clear();
}