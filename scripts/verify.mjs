import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const checks = [
  ["format", ["npm", "run", "format:check"]],
  ["lint", ["npm", "run", "lint"]],
  ["typecheck", ["npm", "run", "typecheck"]],
  ["unit-coverage", ["npm", "test"]],
  ["api-contract", ["npm", "run", "test:api-contract"]],
  ["delivery-scripts", ["npm", "run", "test:delivery"]],
  ["operations-scripts", ["npm", "run", "test:operations"]],
  ["demo-scenarios", ["npm", "run", "test:demo"]],
  ["self-modification", ["npm", "run", "test:self-modification"]],
  ["accessibility", ["npm", "run", "test:accessibility"]],
  ["build", ["npm", "run", "build"]],
  ["workflow-yaml", ["npm", "run", "verify:workflows"]],
  ["dependency-audit", ["npm", "run", "scan:dependencies"]],
  ["secret-scan", ["npm", "run", "scan:secrets"]],
  ["iac-static", ["npm", "run", "scan:iac"]],
  ["bicep-compile", ["npm", "run", "verify:bicep"]],
  ["container-static", ["npm", "run", "scan:container"]],
  ["agentic-sync", ["npm", "run", "verify:agentic-sync"]],
  ["mutation", ["npm", "run", "test:mutation"]],
];

await rm(".evidence", { recursive: true, force: true });
let failed = false;
const outcomes = [];

for (const [id, command] of checks) {
  console.log(`\n=== ${id} ===`);
  const result = spawnSync(
    process.execPath,
    ["scripts/record-evidence.mjs", id, "--", ...command],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed = true;
  outcomes.push({
    id,
    status: result.status === 0 ? "passed" : "failed",
    command: command.join(" "),
    exitCode: result.status ?? 1,
  });
  await mkdir(".evidence/checks", { recursive: true });
  await Promise.all(
    outcomes.map((outcome) =>
      writeFile(
        `.evidence/checks/${outcome.id}.json`,
        `${JSON.stringify(outcome, null, 2)}\n`,
      ),
    ),
  );
}

const evidence = spawnSync(
  process.execPath,
  ["scripts/evidence.mjs", "generate-and-validate"],
  { stdio: "inherit" },
);
if (evidence.status !== 0) failed = true;
process.exitCode = failed ? 1 : 0;
