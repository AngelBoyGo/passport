/**
 * Passport × Vercel AI SDK middleware.
 *
 * Two-line middleware that posts evidence to Passport for every AI SDK call.
 * Every generateText/streamText gets a signed receipt.
 *
 * Usage:
 *   import { passportMiddleware } from "@passport7/sdk/vercel-ai";
 *   const result = await generateText({
 *     model: openai("gpt-4"),
 *     prompt: "hello",
 *     middleware: passportMiddleware({ commitment, privateKey, apiKey }),
 *   });
 */
interface PassportVercelConfig {
    commitment: string;
    privateKey: string;
    apiKey: string;
    baseUrl?: string;
    sourceType?: string;
}
declare function passportMiddleware(config: PassportVercelConfig): any;

export { type PassportVercelConfig, passportMiddleware };
