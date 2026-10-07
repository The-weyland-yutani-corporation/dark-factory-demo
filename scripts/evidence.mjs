import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const mode = process.argv[2] ?? "generate";
const evidenceRoot = ".evidence";
const checksRoot = path.join(evidenceRoot, "checks");
const manifestPath = path.join(evidenceRoot, "manifest.json");
const policy = JSON.parse(await readFile("verification/policy.json", "utf8"));

async function existingArtifacts() {
  const candidates = [
    "coverage/coverage-summary.json",
    "coverage/lcov.info",
    "reports/mutation/mutation.json",
    "reports/bicep/main.json",
    "reports/trivy/filesystem.sarif",
    "reports/trivy/container.sarif",
    "reports/azure/historical-validation.json",
  ];
  const artifacts = [];
  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate);
      const details = await stat(candidate);
      artifacts.push({
        path: candidate.replaceAll("\\", "/"),
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: details.size,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function readChecks() {
  let files = [];
  try {
    files = await readdir(checksRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const checks = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    checks.push(
      JSON.parse(await readFile(path.join(checksRoot, file), "utf8")),
    );
  }
  return checks.sort((left, right) => left.id.localeCompare(right.id));
}

function commitIdentifier() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "working-tree";
  }
}

async function generate() {
  const manifest = {
    schemaVersion: 1,
    commit: commitIdentifier(),
    generatedAt: new Date().toISOString(),
    checks: await readChecks(),
    artifacts: await existingArtifacts(),
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function validate(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!manifest.commit) errors.push("commit is required");
  if (!Array.isArray(manifest.checks)) errors.push("checks must be an array");
  if (!Array.isArray(manifest.artifacts))
    errors.push("artifacts must be an array");

  const byId = new Map(
    (manifest.checks ?? []).map((check) => [check.id, check]),
  );
  for (const required of policy.requiredChecks) {
    const check = byId.get(required);
    if (!check) errors.push(`missing required check: ${required}`);
    else if (check.status !== "passed")
      errors.push(`required check did not pass: ${required} (${check.status})`);
  }

  const duplicates = (manifest.checks ?? [])
    .map((check) => check.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicates.length > 0)
    errors.push(`duplicate check ids: ${[...new Set(duplicates)].join(", ")}`);

  if (errors.length > 0) {
    for (const error of errors) console.error(`evidence: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Evidence policy passed with ${manifest.checks.length} checks and ${manifest.artifacts.length} artifacts.`,
  );
}

if (mode === "generate") {
  await generate();
} else if (mode === "validate") {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    manifest = await generate();
  }
  validate(manifest);
} else if (mode === "generate-and-validate") {
  validate(await generate());
} else {
  console.error(`Unknown evidence mode: ${mode}`);
  process.exitCode = 2;
}
