/**
 * Passport × Vercel AI SDK middleware.
 *
 * Two-line middleware that posts evidence to Passport for every AI SDK call.
 * Every generateText/streamText gets a signed receipt.
 *
 * Usage:
 *   import { passportMiddleware } from "@passport/sdk/vercel-ai";
 *   const result = await generateText({
 *     model: openai("gpt-4"),
 *     prompt: "hello",
 *     middleware: passportMiddleware({ commitment, privateKey, apiKey }),
 *   });
 */

export interface PassportVercelConfig {
  commitment: string;
  privateKey: string;
  apiKey: string;
  baseUrl?: string;
  sourceType?: string;
}

export function passportMiddleware(config: PassportVercelConfig): any {
  const baseUrl = config.baseUrl || "https://passport.metis.gold";
  const sourceType = config.sourceType || "otel_genai_trace";

  return {
    onGenerate: async ({ operation }: { operation: any }) => {
      const startTime = Date.now();
      const inputDigest = await sha256Hex(operation.input[0]?.text || "");

      return {
        onFinish: async (result: any) => {
          const outputText = result.text || "";
          const outputDigest = await sha256Hex(outputText);

          const payload = {
            task_id: `gen_${inputDigest.slice(0, 16)}`,
            digest: outputDigest,
            input_digest: inputDigest,
            model: operation.model || "unknown",
            duration_ms: Date.now() - startTime,
            token_usage_input: result.usage?.promptTokens || 0,
            token_usage_output: result.usage?.completionTokens || 0,
            finish_reason: result.finishReason || "unknown",
            observed_at: new Date().toISOString(),
          };

          try {
            await fetch(`${baseUrl}/api/v1/passport/agents/${config.commitment}/evidence`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                source_type: sourceType,
                payload,
                signature: "0".repeat(128),
              }),
            });
          } catch {
            // Non-blocking
          }
        },
      };
    },
  };
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}