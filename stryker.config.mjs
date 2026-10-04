export default {
  mutate: ["packages/policy-engine/src/**/*.ts"],
  testRunner: "command",
  commandRunner: {
    command: "npx vitest run tests/policy-engine.test.ts",
  },
  checkers: ["typescript"],
  coverageAnalysis: "all",
  reporters: ["clear-text", "progress", "json"],
  ignorePatterns: ["coverage", "reports", ".evidence", "apps/web/dist"],
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    high: 90,
    low: 80,
    break: 80,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
