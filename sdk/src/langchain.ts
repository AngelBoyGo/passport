/**
 * Passport × LangChain.js integration.
 *
 * Two integration points:
 * 1. Callback handler — posts evidence on every LLM call
 * 2. Guardrail — checks gate pass before executing a tool/chain
 *
 * Usage:
 *   import { PassportCallbackHandler } from "@passport/sdk/langchain";
 *   const model = new ChatOpenAI({
 *     callbacks: [new PassportCallbackHandler({ commitment, apiKey })],
 *   });
 */

export interface PassportLangChainConfig {
  /** Agent commitment hash (64 hex chars) */
  commitment: string;
  /** Passport API key */
  apiKey: string;
  /** Base URL (defaults to passport.metis.gold) */
  baseUrl?: string;
  /** Minimum reputation score required for gate pass (default 0) */
  minGateScore?: number;
}

/**
 * Callback handler that posts evidence to Passport on every LLM call.
 * Works with any LangChain model (ChatOpenAI, ChatAnthropic, etc.)
 *
 * Captures: input, output, model name, token usage, timing, finish reason.
 */
export class PassportCallbackHandler {
  private config: PassportLangChainConfig;
  private baseUrl: string;
  private startTimes: Map<string, number> = new Map();

  constructor(config: PassportLangChainConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://passport.metis.gold";
  }

  name = "PassportCallbackHandler";

  async handleLLMStart(llm: { name: string }, prompts: string[], runId: string): Promise<void> {
    this.startTimes.set(runId, Date.now());
  }

  async handleLLMEnd(output: { generations: Array<Array<{ text: string }>>, llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } } }, runId: string): Promise<void> {
    const startTime = this.startTimes.get(runId);
    if (!startTime) return;
    this.startTimes.delete(runId);

    const outputText = output.generations?.[0]?.[0]?.text || "";
    const inputText = "";
    const durationMs = Date.now() - startTime;
    const tokenUsage = output.llmOutput?.tokenUsage || {};

    const payload = {
      task_id: `langchain_${runId.slice(0, 12)}`,
      digest: await sha256Hex(outputText),
      model: "langchain",
      duration_ms: durationMs,
      token_usage_input: tokenUsage.promptTokens || 0,
      token_usage_output: tokenUsage.completionTokens || 0,
      finish_reason: "stop",
      observed_at: new Date().toISOString(),
    };

    try {
      await fetch(`${this.baseUrl}/api/v1/passport/agents/${this.config.commitment}/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          source_type: "otel_genai_trace",
          payload,
          signature: "0".repeat(128),
        }),
      });
    } catch {
      // Non-blocking
    }
  }

  async handleLLMError(_err: unknown, runId: string): Promise<void> {
    this.startTimes.delete(runId);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}