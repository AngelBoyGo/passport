/**
 * Live discovery sources index (Phase 19). Extendable: add new sources here, no core change.
 */

import type { DiscoverySource } from "./contract";
import { FrankfurterSource } from "./frankfurter";
import { GoldApiSource } from "./gold-api";
import { GitHubDirectorySource } from "./github-directory";

export const DISCOVERY_SOURCES: DiscoverySource[] = [
  FrankfurterSource,
  GoldApiSource,
  GitHubDirectorySource,
];

export { FrankfurterSource, GoldApiSource, GitHubDirectorySource };
export type { DiscoverySource } from "./contract";
