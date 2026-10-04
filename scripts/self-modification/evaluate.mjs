import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDecisionCorrelation } from "../correlation.mjs";
import { runTrustedHarness } from "./trusted-harness.mjs";
import {
  classifySurface,
  compareEvidenceCoverage,
  replayCanonicalScenarios,
  runCanary,
  sha256,
  signVerdict,
  stableJson,
} from "./core.mjs";

const root = process.cwd();
const candidateRoot = path.resolve(
  process.env.SELF_MODIFICATION_CANDIDATE_ROOT ?? root,
);
const output =
  process.env.SELF_MODIFICATION_RESULT ??
  "reports/self-modification/verdict.json";
const timeout = Number(process.env.SELF_MODIFICATION_TIMEOUT_MS ?? 120000);
const autonomy = JSON.parse(
  await readFile(".github/autonomy/policy.json", "utf8"),
);
const policy = autonomy.selfModification;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    shell: false,
    ...options,
  });
}
const git = (args, options = {}) =>
  run("git", ["--no-pager", ...args], options);
const candidateGit = (args) =>
  run("git", ["--no-pager", ...args], { cwd: candidateRoot });
const readJson = (file) => readFile(file, "utf8").then(JSON.parse);
const exists = (file) =>
  stat(file)
    .then(() => true)
    .catch(() => false);

function changedFiles() {
  if (process.env.SELF_MODIFICATION_CHANGED_FILES) {
    return process.env.SELF_MODIFICATION_CHANGED_FILES.split(/\r?\n/)
      .map((file) => file.trim().replaceAll("\\", "/"))
      .filter(Boolean)
      .sort();
  }
  const base = process.env.SELF_MODIFICATION_BASE ?? "HEAD";
  const tracked = git(["diff", "--name-only", base, "--"]).stdout;
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).stdout;
  return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/))]
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort();
}

async function baselinePolicy() {
  const reference = process.env.SELF_MODIFICATION_BASE ?? "HEAD";
  const result = git(["show", `${reference}:verification/policy.json`]);
  return result.status === 0
    ? JSON.parse(result.stdout)
    : readJson("verification/policy.json");
}

async function copyCandidate(workspace) {
  const listing = candidateGit([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (listing.status !== 0) throw new Error(listing.stderr);
  for (const relative of listing.stdout.split(/\r?\n/).filter(Boolean)) {
    const source = path.join(candidateRoot, relative);
    if (!(await exists(source))) continue;
    const destination = path.join(workspace, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  run("git", ["init", "--quiet", workspace]);
}

const files = changedFiles();
const surfaces = files
  .map((file) => classifySurface(file, policy))
  .filter((item) => item.protectedSurface || item.factorySurface);
const head = candidateGit(["rev-parse", "HEAD"]).stdout.trim();
const operationId = sha256(
  stableJson({
    head,
    files,
    diff: candidateGit(["diff", "--binary", "HEAD", "--"]).stdout,
  }),
).slice(0, 24);
const workspace = path.join(
  root,
  ".self-modification",
  "workspaces",
  operationId,
);
await rm(workspace, { recursive: true, force: true });
await mkdir(workspace, { recursive: true });

let verdict;
try {
  await copyCandidate(workspace);
  const [oldPolicy, newPolicy] = await Promise.all([
    baselinePolicy(),
    readJson(path.join(workspace, "verification/policy.json")),
  ]);
  const coverage = compareEvidenceCoverage(
    oldPolicy.requiredChecks,
    newPolicy.requiredChecks,
  );
  const scenarios = replayCanonicalScenarios();
  const trusted = await runTrustedHarness({
    baselineRoot: root,
    workspace,
    surfaces,
    timeout,
  });
  const checks = trusted.checks;
  const ledger = new Map();
  const syntheticGoal = {
    goalKey: `self-modification-canary-${operationId}`,
    outcome: "exercise intake, repair, integration, and incident recovery",
  };
  const canaryInput = {
    workflowVersion: operationId,
    syntheticGoal,
    elapsedMs: scenarios.length * 10,
    timeoutMs: policy.canaryTimeoutSeconds * 1000,
    successful: scenarios.every((item) => item.passed),
    ledger,
  };
  const canary = runCanary(canaryInput);
  const idempotencyProbe = runCanary(canaryInput);
  const reasons = [];
  if (surfaces.length === 0)
    reasons.push("no protected or factory surface changed");
  if (!coverage.passed)
    reasons.push(`evidence coverage removed: ${coverage.removed.join(", ")}`);
  if (scenarios.some((item) => !item.passed))
    reasons.push("one or more canonical scenarios failed");
  checks
    .filter((item) => !item.passed)
    .forEach((item) => reasons.push(`${item.id} validation failed`));
  if (!canary.activated) reasons.push(`canary ${canary.reason}`);
  if (!idempotencyProbe.idempotentReplay)
    reasons.push("canary activation was not idempotent");
  verdict = signVerdict({
    schemaVersion: 1,
    verdictId: operationId,
    repository:
      process.env.GITHUB_REPOSITORY ??
      git(["config", "--get", "remote.origin.url"]).stdout.trim() ??
      "local",
    candidateSha: process.env.HEAD_SHA ?? head,
    baseline: process.env.SELF_MODIFICATION_BASE ?? head,
    workflowRunId: process.env.GITHUB_RUN_ID ?? "local",
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
    evaluatedAt: new Date().toISOString(),
    isolatedWorkspace: {
      kind: "ephemeral-git-repository",
      liveSettingsMutated: false,
      operationId,
    },
    surfaces,
    evidenceCoverage: coverage,
    scenarios,
    toolChecks: checks,
    trustedEvidence: trusted.evidence,
    canary,
    idempotencyProbe,
    decision: { allowed: reasons.length === 0, reasons },
    correlation: createDecisionCorrelation({
      goalId: process.env.GOAL_ID,
      pullRequest: process.env.PR_NUMBER,
      commitSha: process.env.HEAD_SHA ?? head,
      workflowRunId: process.env.GITHUB_RUN_ID,
      policyVerdict:
        reasons.length === 0
          ? "allow:self-modification"
          : "deny:self-modification",
    }),
  });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(verdict, null, 2)}\n`);
console.log(
  verdict.decision.allowed
    ? `Self-modification evaluation passed: ${verdict.verdictId}`
    : `Self-modification evaluation denied: ${verdict.decision.reasons.join("; ")}`,
);
if (process.env.GITHUB_OUTPUT)
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `allowed=${verdict.decision.allowed}\nverdict_id=${verdict.verdictId}\n`,
    { flag: "a" },
  );
if (!verdict.decision.allowed) process.exitCode = 1;
