import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/middleware/mastra.ts", "src/vercel-ai.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".js" };
  },
});
