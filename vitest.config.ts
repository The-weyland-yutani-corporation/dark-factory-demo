import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@dark-factory/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@dark-factory/observability": fileURLToPath(
        new URL("./packages/observability/src/index.ts", import.meta.url),
      ),
      "@dark-factory/policy-engine": fileURLToPath(
        new URL("./packages/policy-engine/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    testTimeout: 60_000,
    pool: "threads",
    maxWorkers: 2,
    minWorkers: 1,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "apps/api/src/app.ts",
        "packages/observability/src/index.ts",
        "packages/policy-engine/src/index.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});
