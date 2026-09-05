import type { ErrorTranche } from "@passport7/sdk";
import type { FinalizeStatus } from "@passport7/sdk";
/**
 * Derives finalize status from error tranche.
 */
export declare function deriveCloseStatus(errorTranche: ErrorTranche): FinalizeStatus;
/**
 * Returns ISO-8601 expiry string 30 days from now.
 */
export declare function defaultExpiry(now?: number): string;
/**
 * Deterministic agent id from host + cwd.
 */
export declare function generateAgentId(host?: string, cwd?: string): string;
/**
 * Maps thrown errors to Passport error tranches.
 */
export declare function mapErrorToTranche(err: unknown): ErrorTranche;
