"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/langchain.ts
var langchain_exports = {};
__export(langchain_exports, {
  PassportCallbackHandler: () => PassportCallbackHandler
});
module.exports = __toCommonJS(langchain_exports);
var PassportCallbackHandler = class {
  config;
  baseUrl;
  startTimes = /* @__PURE__ */ new Map();
  constructor(config) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://passport.metis.gold";
  }
  name = "PassportCallbackHandler";
  async handleLLMStart(llm, prompts, runId) {
    this.startTimes.set(runId, Date.now());
  }
  async handleLLMEnd(output, runId) {
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
      observed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await fetch(`${this.baseUrl}/api/v1/passport/agents/${this.config.commitment}/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          source_type: "otel_genai_trace",
          payload,
          signature: "0".repeat(128)
        })
      });
    } catch {
    }
  }
  async handleLLMError(_err, runId) {
    this.startTimes.delete(runId);
  }
};
async function sha256Hex(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PassportCallbackHandler
});
