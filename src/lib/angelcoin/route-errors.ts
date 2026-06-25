import { NextResponse } from "next/server";
import {
  AngelCoinAccountNotFoundError,
  InsufficientAngelCoinFundsError,
  InvalidAgentCommitmentError,
  InvalidAngelCoinAmountError,
  InvalidUnlockAmountError,
} from "@/lib/angelcoin/errors";

/**
 * Maps AngelCoin service errors to HTTP responses.
 */
export function angelcoinErrorResponse(err: unknown): NextResponse | null {
  if (
    err instanceof InvalidAgentCommitmentError ||
    (err instanceof Error && err.name === "InvalidAgentCommitmentError")
  ) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid commitment" }, { status: 400 });
  }
  if (
    err instanceof InvalidAngelCoinAmountError ||
    (err instanceof Error && err.name === "InvalidAngelCoinAmountError")
  ) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid amount" }, { status: 400 });
  }
  if (
    err instanceof InvalidUnlockAmountError ||
    (err instanceof Error && err.name === "InvalidUnlockAmountError")
  ) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid unlock" }, { status: 400 });
  }
  if (
    err instanceof InsufficientAngelCoinFundsError ||
    (err instanceof Error && err.name === "InsufficientAngelCoinFundsError")
  ) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Insufficient funds" }, { status: 402 });
  }
  if (
    err instanceof AngelCoinAccountNotFoundError ||
    (err instanceof Error && err.name === "AngelCoinAccountNotFoundError")
  ) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Not found" }, { status: 404 });
  }
  return null;
}
