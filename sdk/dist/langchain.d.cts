/**
 * Passport × LangChain.js integration.
 *
 * Two integration points:
 * 1. Callback handler — posts evidence on every LLM call
 * 2. Guardrail — checks gate pass before executing a tool/chain
 *
 * Usage:
 *   import { PassportCallbackHandler } from "@passport7/sdk/langchain";
 *   const model = new ChatOpenAI({
 *     callbacks: [new PassportCallbackHandler({ commitment, apiKey })],
 *   });
 */
interface PassportLangChainConfig {
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
declare class PassportCallbackHandler {
    private config;
    private baseUrl;
    private startTimes;
    constructor(config: PassportLangChainConfig);
    name: string;
    handleLLMStart(llm: {
        name: string;
    }, prompts: string[], runId: string): Promise<void>;
    handleLLMEnd(output: {
        generations: Array<Array<{
            text: string;
        }>>;
        llmOutput?: {
            tokenUsage?: {
                promptTokens?: number;
                completionTokens?: number;
            };
        };
    }, runId: string): Promise<void>;
    handleLLMError(_err: unknown, runId: string): Promise<void>;
}

export { PassportCallbackHandler, type PassportLangChainConfig };
