import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  CANONICAL_SCENARIOS,
  classifySurface,
  compareEvidenceCoverage,
  replayCanonicalScenarios,
  runCanary,
  signVerdict,
  verifyVerdict,
} from "./core.mjs";
import { runTrustedHarness } from "./trusted-harness.mjs";

const repositoryRoot = process.cwd();
const adversarialRoot = path.join(
  repositoryRoot,
  ".self-modification",
  "adversarial-tests",
);

async function fixture(name, files) {
  const workspace = path.join(adversarialRoot, name);
  await rm(workspace, { recursive: true, force: true });
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(workspace, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return workspace;
}

const surface = (file) => ({
  file,
  protectedSurface: true,
  factorySurface: true,
});

test("replays every canonical safety and recovery scenario", () => {
  const results = replayCanonicalScenarios();
  assert.equal(results.length, 8);
  assert.deepEqual(
    results.map((item) => item.id),
    CANONICAL_SCENARIOS.map((item) => item.id),
  );
  assert.ok(results.every((item) => item.passed));
});

test("classifies protected and factory surfaces", () => {
  const policy = {
    protectedPaths: [".github", "scripts", "infra"],
    factoryPaths: [".github/workflows", "scripts/self-modification"],
  };
  assert.deepEqual(classifySurface(".github/workflows/ci.yml", policy), {
    file: ".github/workflows/ci.yml",
    protectedSurface: true,
    factorySurface: true,
  });
  assert.equal(
    classifySurface("apps/api/src/app.ts", policy).protectedSurface,
    false,
  );
});

test("evidence coverage can grow but cannot shrink", () => {
  assert.equal(compareEvidenceCoverage(["a"], ["a", "b"]).passed, true);
  assert.deepEqual(compareEvidenceCoverage(["a", "b"], ["a"]).removed, ["b"]);
});

test("canary timeout reverts to terminal incident and is idempotent", () => {
  const ledger = new Map();
  const input = {
    workflowVersion: "v2",
    syntheticGoal: { goalKey: "canary" },
    timeoutMs: 100,
    ledger,
  };
  const timeout = runCanary({ ...input, elapsedMs: 101, successful: true });
  assert.equal(timeout.activated, false);
  assert.equal(timeout.reverted, true);
  assert.equal(timeout.terminalIncident, true);
  const replay = runCanary({ ...input, elapsedMs: 1, successful: true });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.reason, "canary-timeout");
});

test("signed verdicts detect tampering", () => {
  const verdict = signVerdict({
    schemaVersion: 1,
    decision: { allowed: true },
  });
  assert.equal(verifyVerdict(verdict), true);
  assert.equal(
    verifyVerdict({ ...verdict, decision: { allowed: false } }),
    false,
  );
});

test("trusted harness rejects a candidate evidence recorder that always passes", async () => {
  const workspace = await fixture("record-evidence-always-passes", {
    "scripts/record-evidence.mjs": `
      import { mkdir, writeFile } from "node:fs/promises";
      await mkdir(".evidence/checks", { recursive: true });
      await writeFile(".evidence/checks/trusted-failure.json",
        JSON.stringify({ id: "trusted-failure", status: "passed", exitCode: 0 }));
    `,
    ".evidence/manifest.json": JSON.stringify({
      checks: [{ id: "evidence-recorder-semantics", status: "passed" }],
    }),
  });
  const evaluated = await runTrustedHarness({
    baselineRoot: repositoryRoot,
    workspace,
    surfaces: [surface("scripts/record-evidence.mjs")],
    timeout: 30000,
  });
  assert.equal(
    evaluated.checks.find((check) => check.id === "evidence-recorder-semantics")
      .passed,
    false,
  );
  assert.equal(evaluated.evidence.candidateEvidenceAccepted, false);
  await rm(workspace, { recursive: true, force: true });
});

test("trusted harness rejects removed self-modification enforcement", async () => {
  const workspace = await fixture("removed-self-mod-enforcement", {
    "scripts/self-modification/core.mjs": `
      export const CANONICAL_SCENARIOS = [];
      export const replayCanonicalScenarios = () => [];
      export const compareEvidenceCoverage = () => ({ passed: true });
      export const runCanary = () => ({
        activated: true, reverted: false, terminalIncident: false,
        idempotentReplay: true
      });
    `,
    "scripts/self-modification/self-test.mjs":
      'import test from "node:test"; test("always passes", () => {});',
  });
  const evaluated = await runTrustedHarness({
    baselineRoot: repositoryRoot,
    workspace,
    surfaces: [surface("scripts/self-modification/core.mjs")],
    timeout: 30000,
  });
  assert.equal(
    evaluated.checks.find((check) => check.id === "self-modification-semantics")
      .passed,
    false,
  );
  await rm(workspace, { recursive: true, force: true });
});

test("trusted evaluator probe rejects an evaluator that always allows", async () => {
  const workspace = await fixture("evaluator-always-allows", {
    "scripts/self-modification/evaluate.mjs": "process.exitCode = 0;",
  });
  const execution = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "scripts/self-modification/trusted-probes.mjs"),
      "evaluator",
      workspace,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30000,
      shell: false,
    },
  );
  assert.notEqual(execution.status, 0);
  await rm(workspace, { recursive: true, force: true });
});

test("trusted harness rejects a policy engine that allows missing enforcement", async () => {
  const workspace = await fixture("weakened-policy-engine", {
    "packages/policy-engine/dist/index.js": `
      export function evaluateIntegrationGate() {
        return { allowed: true, reasons: [] };
      }
    `,
  });
  const evaluated = await runTrustedHarness({
    baselineRoot: repositoryRoot,
    workspace,
    surfaces: [surface("packages/policy-engine/src/index.ts")],
    timeout: 30000,
    run(command, args, options = {}) {
      if (
        command === process.env.ComSpec ||
        (command === "npx" && args[0] === "tsc")
      )
        return { status: 0, stdout: "", stderr: "" };
      return spawnSync(command, args, {
        cwd: workspace,
        encoding: "utf8",
        timeout: 30000,
        shell: false,
        ...options,
      });
    },
  });
  assert.equal(
    evaluated.checks.find((check) => check.id === "policy-engine-semantics")
      .passed,
    false,
  );
  await rm(workspace, { recursive: true, force: true });
});
