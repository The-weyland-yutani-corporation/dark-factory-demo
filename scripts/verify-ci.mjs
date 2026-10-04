import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const checks = [
  ["format", ["npm", "run", "format:check"]],
  ["lint", ["npm", "run", "lint"]],
  ["typecheck", ["npm", "run", "typecheck"]],
  ["unit-coverage", ["npm", "test"]],
  ["api-contract", ["npm", "run", "test:api-contract"]],
  ["delivery-scripts", ["npm", "run", "test:delivery"]],
  ["self-modification", ["npm", "run", "test:self-modification"]],
  ["accessibility", ["npm", "run", "test:accessibility"]],
  ["build", ["npm", "run", "build"]],
  ["workflow-yaml", ["npm", "run", "verify:workflows"]],
  ["dependency-audit", ["npm", "run", "scan:dependencies"]],
  ["secret-scan", ["npm", "run", "scan:secrets"]],
  ["iac-static", ["npm", "run", "scan:iac"]],
  ["container-static", ["npm", "run", "scan:container"]],
  ["agentic-sync", ["npm", "run", "verify:agentic-sync"]],
  ["mutation", ["npm", "run", "test:mutation"]],
];

await rm(".evidence", { recursive: true, force: true });
for (const [id, command] of checks) {
  console.log(`\n=== ${id} ===`);
  spawnSync(
    process.execPath,
    ["scripts/record-evidence.mjs", id, "--", ...command],
    { stdio: "inherit" },
  );
}

// The workflow records the official Bicep build action outcome, then enforces
// the complete manifest. This process exits successfully so every check runs.
