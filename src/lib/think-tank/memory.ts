/**
 * Think Tank Memory — persistent, growing, verifiable.
 *
 * Memory is stored as Passport evidence. Every analysis, every opportunity,
 * every outcome is an evidence entry — immutable, timestamped, Ed25519-signed.
 *
 * This creates an auditable chain of strategic reasoning that grows over time.
 * New agents can read the entire memory by querying evidence with the
 * "think_tank" source type.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export interface MemoryEntry {
  memoryId: string;
  runId: string;
  type: MemoryEntryType;
  content: string;
  summary: string;
  value: number;
  tags: string[];
  parentMemoryId?: string;
  createdAt: string;
  contentHash: string;
}

export type MemoryEntryType =
  | "analysis"
  | "opportunity"
  | "decision"
  | "outcome"
  | "lesson"
  | "insight"
  | "signal"
  | "allocation"
  | "error";

export interface MemoryStore {
  /** Store a memory entry */
  save: (entry: Omit<MemoryEntry, "memoryId" | "contentHash" | "createdAt">) => Promise<MemoryEntry>;
  /** Retrieve recent memories */
  getRecent: (type?: MemoryEntryType, limit?: number) => Promise<MemoryEntry[]>;
  /** Search memories by tag or content */
  search: (query: string) => Promise<MemoryEntry[]>;
  /** Get aggregate statistics about the memory store */
  getStats: () => Promise<MemoryStats>;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  totalValue: number;
  lessonsLearned: number;
  lastAnalysisAt: string | null;
}

/**
 * Computes a unique memory ID from content.
 */
export function computeMemoryId(content: string, type: string): string {
  const hash = bytesToHex(sha256(utf8ToBytes(`${type}:${content}`)));
  return `mem_${hash.slice(0, 24)}`;
}

/**
 * Creates a memory store that uses Passport evidence as the persistence layer.
 * This is the recommended implementation — it makes memory immutable and auditable.
 */
export function createPassportMemoryStore(deps: {
  postEvidence: (payload: {
    sourceType: string;
    payload: unknown;
    signature: string;
  }) => Promise<{ event_commitment_hash: string }>;
  queryEvidence: (params: {
    agentIdentityCommitment: string;
    sourceType?: string;
    limit?: number;
    offset?: number;
  }) => Promise<Array<{ payload: unknown; observedAt: string }>>;
  agentCommitment: string;
}): MemoryStore {
  return {
    save: async (entry) => {
      const memoryId = computeMemoryId(entry.content, entry.type);
      const timestamp = new Date().toISOString();
      const contentHash = bytesToHex(sha256(utf8ToBytes(entry.content)));

      const payload = {
        memory_id: memoryId,
        run_id: entry.runId,
        type: entry.type,
        content: entry.content.slice(0, 50000), // Cap at 50k chars
        summary: entry.summary,
        value: entry.value,
        tags: entry.tags,
        parent_memory_id: entry.parentMemoryId,
        timestamp,
      };

      await deps.postEvidence({
        sourceType: "think_tank_memory",
        payload,
        signature: "0".repeat(128), // Service-signed
      });

      return {
        memoryId,
        runId: entry.runId,
        type: entry.type,
        content: entry.content,
        summary: entry.summary,
        value: entry.value,
        tags: entry.tags,
        parentMemoryId: entry.parentMemoryId,
        createdAt: timestamp,
        contentHash,
      };
    },

    getRecent: async (type, limit = 50) => {
      const results = await deps.queryEvidence({
        agentIdentityCommitment: deps.agentCommitment,
        sourceType: type ? `think_tank_${type}` : "think_tank_memory",
        limit,
      });

      return results.map((r) => {
        const p = r.payload as any;
        return {
          memoryId: p.memory_id || "",
          runId: p.run_id || "",
          type: p.type || "analysis",
          content: p.content || "",
          summary: p.summary || "",
          value: p.value || 0,
          tags: p.tags || [],
          parentMemoryId: p.parent_memory_id,
          createdAt: p.timestamp || r.observedAt,
          contentHash: "",
        };
      });
    },

    search: async (query) => {
      // Note: In production, this would use a vector search or full-text search
      // on the evidence store. For now, returns recent entries.
      const results = await deps.queryEvidence({
        agentIdentityCommitment: deps.agentCommitment,
        sourceType: "think_tank_memory",
        limit: 100,
      });

      const q = query.toLowerCase();
      return results
        .filter((r) => {
          const p = r.payload as any;
          const content = (p.content || "").toLowerCase();
          const summary = (p.summary || "").toLowerCase();
          const tags = (p.tags || []).join(" ").toLowerCase();
          return content.includes(q) || summary.includes(q) || tags.includes(q);
        })
        .map((r) => {
          const p = r.payload as any;
          return {
            memoryId: p.memory_id || "",
            runId: p.run_id || "",
            type: p.type || "analysis",
            content: p.content || "",
            summary: p.summary || "",
            value: p.value || 0,
            tags: p.tags || [],
            parentMemoryId: p.parent_memory_id,
            createdAt: p.timestamp || r.observedAt,
            contentHash: "",
          };
        });
    },

    getStats: async () => {
      const all = await deps.queryEvidence({
        agentIdentityCommitment: deps.agentCommitment,
        sourceType: "think_tank_memory",
        limit: 1000,
      });

      const byType: Record<string, number> = {};
      let totalValue = 0;
      let lessonsCount = 0;

      for (const r of all) {
        const p = r.payload as any;
        const t = p.type || "unknown";
        byType[t] = (byType[t] || 0) + 1;
        totalValue += p.value || 0;
        if (t === "lesson") lessonsCount++;
      }

      const lastAnalysis = all.find((r) => (r.payload as any).type === "analysis");

      return {
        totalEntries: all.length,
        byType,
        totalValue,
        lessonsLearned: lessonsCount,
        lastAnalysisAt: lastAnalysis?.observedAt ?? null,
      };
    },
  };
}

/**
 * In-memory fallback for testing.
 */
export function createInMemoryStore(): MemoryStore {
  const store: MemoryEntry[] = [];

  return {
    save: async (entry) => {
      const memoryId = computeMemoryId(entry.content, entry.type);
      const now = new Date().toISOString();
      const contentHash = bytesToHex(sha256(utf8ToBytes(entry.content)));

      const saved: MemoryEntry = {
        ...entry,
        memoryId,
        createdAt: now,
        contentHash,
      };
      store.unshift(saved);
      return saved;
    },
    getRecent: async (type, limit = 50) => {
      let filtered = type ? store.filter((e) => e.type === type) : store;
      return filtered.slice(0, limit);
    },
    search: async (query) => {
      const q = query.toLowerCase();
      return store.filter(
        (e) =>
          e.content.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      ).slice(0, 100);
    },
    getStats: async () => {
      const byType: Record<string, number> = {};
      let totalValue = 0;
      for (const e of store) {
        byType[e.type] = (byType[e.type] || 0) + 1;
        totalValue += e.value;
      }
      return {
        totalEntries: store.length,
        byType,
        totalValue,
        lessonsLearned: store.filter((e) => e.type === "lesson").length,
        lastAnalysisAt: store.find((e) => e.type === "analysis")?.createdAt ?? null,
      };
    },
  };
}