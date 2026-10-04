import { spawnSync } from "node:child_process";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { sha256, stableJson } from "./core.mjs";

const exists = (file) =>
  stat(file)
    .then(() => true)
    .catch(() => false);

function permissionMap(value) {
  if (value === "read-all") return new Map([["*", 1]]);
  if (value === "write-all") return new Map([["*", 2]]);
  if (!value || typeof value !== "object") return new Map();
  return new Map(
    Object.entries(value).map(([scope, level]) => [
      scope,
      level === "write" ? 2 : level === "read" ? 1 : 0,
    ]),
  );
}

async function workflowPermissionExpansions(
  baselineRoot,
  workspace,
  changedFiles,
) {
  const expansions = [];
  for (const file of changedFiles.filter((item) =>
    /^\.github\/workflows\/.+\.ya?ml$/.test(item),
  )) {
    const candidateFile = path.join(workspace, file);
    if (!(await exists(candidateFile))) continue;
    const candidate = parseDocument(
      await readFile(candidateFile, "utf8"),
    ).toJS();
    const baselineFile = path.join(baselineRoot, file);
    const baseline = (await exists(baselineFile))
      ? parseDocument(await readFile(baselineFile, "utf8")).toJS()
      : {};
    const locations = new Set([
      "workflow",
      ...Object.keys(candidate.jobs ?? {}).map((job) => `job:${job}`),
    ]);
    for (const location of locations) {
      const current =
        location === "workflow"
          ? candidate.permissions
          : candidate.jobs?.[location.slice(4)]?.permissions;
      const previous =
        location === "workflow"
          ? baseline.permissions
          : baseline.jobs?.[location.slice(4)]?.permissions;
      const currentMap = permissionMap(current);
      const previousMap = permissionMap(previous);
      for (const [scope, level] of currentMap) {
        const prior = Math.max(
          previousMap.get(scope) ?? 0,
          previousMap.get("*") ?? 0,
        );
        if (level > prior && level === 2)
          expansions.push(`${file}:${location}:${scope}`);
      }
    }
  }
  return expansions;
}

async function generatedFingerprint(workspace) {
  const directory = path.join(workspace, ".github/workflows");
  if (!(await exists(directory))) return "[]";
  const files = (await readdir(directory))
    .filter(
      (file) =>
        file.endsWith(".lock.yml") || file === "agentics-maintenance.yml",
    )
    .sort();
  return stableJson(
    await Promise.all(
      files.map(async (file) => [
        file,
        sha256(await readFile(path.join(directory, file))),
      ]),
    ),
  );
}

function checkResult(id, execution, required = true) {
  return {
    id,
    required,
    passed: execution.status === 0,
    exitCode: execution.status ?? 1,
    timedOut: execution.error?.code === "ETIMEDOUT",
    output: `${execution.stdout ?? ""}\n${execution.stderr ?? ""}`
      .trim()
      .slice(-4000),
  };
}

export async function runTrustedHarness({
  baselineRoot,
  workspace,
  surfaces,
  timeout,
  run = (command, args, options = {}) =>
    spawnSync(command, args, {
      cwd: workspace,
      encoding: "utf8",
      timeout,
      shell: false,
      ...options,
    }),
}) {
  const files = surfaces.map(({ file }) => file);
  const touches = (...prefixes) =>
    files.some((file) =>
      prefixes.some(
        (prefix) => file === prefix || file.startsWith(`${prefix}/`),
      ),
    );
  const checks = [];
  const expansions = await workflowPermissionExpansions(
    baselineRoot,
    workspace,
    files,
  );
  checks.push({
    id: "workflow-permissions",
    required: true,
    passed: expansions.length === 0,
    output:
      expansions.length === 0
        ? "No write-permission expansion detected."
        : expansions.join("\n"),
  });

  const trustedProbe = (id, mode) =>
    checks.push(
      checkResult(
        id,
        run(process.execPath, [
          path.join(
            baselineRoot,
            "scripts/self-modification/trusted-probes.mjs",
          ),
          mode,
          workspace,
        ]),
      ),
    );

  if (touches("scripts/self-modification")) {
    trustedProbe("self-modification-semantics", "self-modification");
    checks.push(
      checkResult(
        "self-modification-tests",
        run(process.execPath, [
          "--test",
          path.join(workspace, "scripts/self-modification/self-test.mjs"),
        ]),
      ),
    );
  }
  if (
    files.some((file) =>
      [
        "scripts/self-modification/evaluate.mjs",
        "scripts/self-modification/trusted-harness.mjs",
        "scripts/self-modification/trusted-probes.mjs",
      ].includes(file),
    )
  )
    trustedProbe("self-modification-evaluator", "evaluator");
  if (
    touches(
      "scripts/record-evidence.mjs",
      "scripts/evidence.mjs",
      "scripts/verify.mjs",
      "scripts/verify-ci.mjs",
      "verification",
    )
  )
    trustedProbe("evidence-recorder-semantics", "evidence-recorder");

  if (touches("packages/policy-engine", "scripts/integration")) {
    checks.push(
      checkResult(
        "policy-engine-build",
        run(
          process.platform === "win32" ? process.env.ComSpec : "npx",
          process.platform === "win32"
            ? [
                "/d",
                "/s",
                "/c",
                "npx tsc -b packages/contracts packages/policy-engine --pretty false",
              ]
            : [
                "tsc",
                "-b",
                "packages/contracts",
                "packages/policy-engine",
                "--pretty",
                "false",
              ],
        ),
      ),
    );
    if (checks.at(-1).passed)
      trustedProbe("policy-engine-semantics", "policy-engine");
  }

  for (const subsystem of ["integration", "operations", "delivery"]) {
    if (!touches(`scripts/${subsystem}`)) continue;
    const testFile = path.join(workspace, `scripts/${subsystem}/self-test.mjs`);
    if (await exists(testFile))
      checks.push(
        checkResult(
          `${subsystem}-tests`,
          run(process.execPath, ["--test", testFile]),
        ),
      );
  }

  if (touches(".github")) {
    checks.push(
      checkResult(
        "workflow-yaml",
        run(process.execPath, [
          path.join(baselineRoot, "scripts/workflow-lint.mjs"),
        ]),
      ),
    );
  }

  if (
    files.some(
      (file) =>
        /^\.github\/workflows\/.+\.(?:md|lock\.yml)$/.test(file) ||
        file.startsWith(".github/aw/"),
    )
  ) {
    const available = run("gh", ["aw", "--help"]);
    if (available.status !== 0) {
      checks.push({
        id: "gh-aw-sync",
        required: true,
        passed: false,
        output:
          "gh aw is unavailable; candidate-controlled evidence is not accepted as a substitute.",
      });
    } else {
      const before = await generatedFingerprint(workspace);
      const compile = run("gh", ["aw", "compile"]);
      const harden =
        compile.status === 0
          ? run(process.execPath, [
              path.join(baselineRoot, "scripts/fix-generated-workflows.mjs"),
            ])
          : compile;
      const after = await generatedFingerprint(workspace);
      const checked = checkResult("gh-aw-sync", harden);
      checked.passed =
        compile.status === 0 && harden.status === 0 && before === after;
      if (before !== after)
        checked.output =
          `${checked.output}\ncompiled workflow outputs changed`.trim();
      checks.push(checked);
    }
  }

  if (touches("infra"))
    checks.push(
      checkResult(
        "bicep-compile",
        run(process.execPath, [
          path.join(baselineRoot, "scripts/bicep-validate.mjs"),
        ]),
      ),
    );

  const manifest = {
    schemaVersion: 1,
    generatedBy: "trusted-self-modification-harness",
    candidateEvidenceAccepted: false,
    checks: checks.map(({ id, passed, exitCode, timedOut }) => ({
      id,
      status: passed ? "passed" : "failed",
      exitCode,
      timedOut,
    })),
  };
  await mkdir(path.join(workspace, ".trusted-evidence"), { recursive: true });
  await writeFile(
    path.join(workspace, ".trusted-evidence/manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return {
    checks,
    evidence: {
      ...manifest,
      digest: sha256(stableJson(manifest)),
    },
  };
}
