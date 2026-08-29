import { describe, it, expect, vi } from "vitest";
import { PassportCallbackHandler, type PassportLangChainConfig } from "../langchain.js";

describe("PassportCallbackHandler", () => {
  const config: PassportLangChainConfig = {
    commitment: "a".repeat(64),
    apiKey: "pp_usr_test",
    baseUrl: "https://test.example.com",
  };

  it("creates a handler with the correct name", () => {
    const handler = new PassportCallbackHandler(config);
    expect(handler.name).toBe("PassportCallbackHandler");
  });

  it("handleLLMStart records start time", async () => {
    const handler = new PassportCallbackHandler(config);
    await handler.handleLLMStart({ name: "gpt-4" }, ["hello"], "run_1");
    expect(handler["startTimes"].has("run_1")).toBe(true);
  });

  it("handleLLMEnd removes start time", async () => {
    const handler = new PassportCallbackHandler(config);
    await handler.handleLLMStart({ name: "gpt-4" }, ["hello"], "run_1");
    await handler.handleLLMEnd(
      { generations: [[{ text: "world" }]], llmOutput: {} },
      "run_1"
    );
    expect(handler["startTimes"].has("run_1")).toBe(false);
  });

  it("handleLLMError removes start time", async () => {
    const handler = new PassportCallbackHandler(config);
    await handler.handleLLMStart({ name: "gpt-4" }, ["hello"], "run_1");
    await handler.handleLLMError(new Error("fail"), "run_1");
    expect(handler["startTimes"].has("run_1")).toBe(false);
  });
});