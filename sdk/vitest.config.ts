import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@prisma/client": path.resolve(__dirname, "../node_modules/@prisma/client"),
    },
  },
});
