/**
 * Live discovery sources (Phase 19).
 *
 * Each source implements `DiscoverySource.fetch()` and hits a REAL public endpoint. All are
 * unauthenticated so the factory runs live with zero provider keys; authenticated provider
 * sandboxes (Orange/MoMo/MoMo partner APIs) are added as new adapters later.
 */

import type { CandidateInput } from "../types";

export interface DiscoverySource {
  name: string;
  fetch(): Promise<CandidateInput[]>;
}
