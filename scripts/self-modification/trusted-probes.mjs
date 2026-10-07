import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const [mode, workspace] = process.argv.slice(2);
const target = (relative) =>
  `${pathToFileURL(path.join(workspace, relative)).href}?trusted=${Date.now()}`;

if (mode === "self-modification") {
  const core = await import(target("scripts/self-modification/core.mjs"));
  const scenarios = core.replayCanonicalScenarios();
  assert.equal(scenarios.length, core.CANONICAL_SCENARIOS.length);
  assert.ok(scenarios.every((scenario) => scenario.passed));
  assert.equal(core.compareEvidenceCoverage(["a", "b"], ["a"]).passed, false);

  const ledger = new Map();
  const input = {
    workflowVersion: "trusted-probe",
    syntheticGoal: { goalKey: "trusted-canary" },
    timeoutMs: 10,
    ledger,
  };
  const timeout = core.runCanary({
    ...input,
    elapsedMs: 11,
    successful: true,
  });
  assert.equal(timeout.activated, false);
  assert.equal(timeout.reverted, true);
  assert.equal(timeout.terminalIncident, true);
  assert.equal(
    core.runCanary({ ...input, elapsedMs: 1, successful: true })
      .idempotentReplay,
    true,
  );
} else if (mode === "evidence-recorder") {
  const evidenceRoot = path.join(workspace, ".evidence");
  await rm(evidenceRoot, { recursive: true, force: true });
  const execution = spawnSync(
    process.execPath,
    [
      path.join(workspace, "scripts/record-evidence.mjs"),
      "trusted-failure",
      "--",
      process.execPath,
      "-e",
      "process.exit(7)",
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: 30000,
      shell: false,
    },
  );
  assert.notEqual(execution.status, 0);
  const recorded = JSON.parse(
    await readFile(
      path.join(evidenceRoot, "checks/trusted-failure.json"),
      "utf8",
    ),
  );
  assert.equal(recorded.status, "failed");
  assert.equal(recorded.exitCode, 7);
} else if (mode === "policy-engine") {
  const policy = await import(target("packages/policy-engine/dist/index.js"));
  const integrationPolicy = {
    requiredChecks: ["verify"],
    requiredEvidenceChecks: ["format"],
    reviewedStateLabel: "state:reviewed",
    blockingLabels: ["state:terminal"],
    selfModificationPaths: ["scripts"],
    selfModificationApprovalLabel: "self-modification:safe",
    selfModificationVerdictRequired: true,
    deploymentPaths: ["infra"],
    deploymentCompatibilityLabel: "deployment:compatible",
    deploymentIncompatibilityLabel: "deployment:incompatible",
  };
  const decision = policy.evaluateIntegrationGate(integrationPolicy, {
    headSha: "candidate",
    author: "author",
    labels: ["self-modification:safe"],
    goalLabels: ["state:reviewed"],
    changedFiles: ["scripts/record-evidence.mjs"],
    checks: [{ name: "verify", status: "completed", conclusion: "success" }],
    reviews: [{ author: "reviewer", state: "APPROVED", commitId: "candidate" }],
    evidence: {
      schemaVersion: 1,
      commit: "candidate",
      checks: [{ id: "format", status: "passed" }],
    },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join("\n"), /self-modification verdict/i);
} else if (mode === "evaluator") {
  const probeRoot = path.join(
    path.dirname(workspace),
    `${path.basename(workspace)}-trusted-probe`,
  );
  const adversary = path.join(probeRoot, "candidate");
  const resultPath = path.join(probeRoot, "evaluator-verdict.json");
  await rm(probeRoot, { recursive: true, force: true });
  await rm(adversary, { recursive: true, force: true });
  await cp(workspace, adversary, {
    recursive: true,
    filter(source) {
      const relative = path.relative(workspace, source);
      return !(
        relative === ".git" ||
        relative.startsWith(`.git${path.sep}`) ||
        relative === ".self-modification" ||
        relative.startsWith(`.self-modification${path.sep}`) ||
        relative === ".trusted-probe" ||
        relative.startsWith(`.trusted-probe${path.sep}`)
      );
    },
  });
  await writeFile(
    path.join(adversary, "scripts/record-evidence.mjs"),
    `
      import { mkdir, writeFile } from "node:fs/promises";
      await mkdir(".evidence/checks", { recursive: true });
      await writeFile(".evidence/checks/trusted-failure.json",
        JSON.stringify({ id: "trusted-failure", status: "passed", exitCode: 0 }));
    `,
  );
  spawnSync("git", ["init", "--quiet"], {
    cwd: adversary,
    encoding: "utf8",
    shell: false,
  });
  const execution = spawnSync(
    process.execPath,
    [path.join(workspace, "scripts/self-modification/evaluate.mjs")],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: 60000,
      shell: false,
      env: {
        ...process.env,
        SELF_MODIFICATION_CANDIDATE_ROOT: adversary,
        SELF_MODIFICATION_CHANGED_FILES: "scripts/record-evidence.mjs",
        SELF_MODIFICATION_RESULT: resultPath,
      },
    },
  );
  assert.notEqual(
    execution.status,
    0,
    "candidate evaluator allowed a recorder that falsified failed evidence",
  );
  const verdict = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(verdict.decision.allowed, false);
  await rm(probeRoot, { recursive: true, force: true });
} else {
  await mkdir(workspace, { recursive: true });
  throw new Error(`Unknown trusted probe: ${mode}`);
}
