import type { PassportClient } from "@passport/sdk";
/**
 * Runs fn and finalizes the receipt with a mapped tranche on throw, then rethrows.
 */
export declare function withFaultCapture<T>(client: PassportClient, receiptId: string, fn: () => Promise<T> | T): Promise<T>;
