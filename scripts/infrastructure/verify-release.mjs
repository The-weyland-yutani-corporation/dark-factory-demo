import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const checkName = "autonomous-integration/evidence";

export function evaluateVerificationEvidence(manifest, expectedSha, required) {
  const reasons = [];
  if (manifest?.schemaVersion !== 1)
    reasons.push("verification evidence schema is unsupported");
  if (manifest?.commit !== expectedSha)
    reasons.push("verification evidence does not match the deployment SHA");

  const checks = new Map(
    (manifest?.checks ?? []).map((check) => [check.id, check.status]),
  );
  for (const id of required) {
    if (checks.get(id) !== "passed")
      reasons.push(`required verification check did not pass: ${id}`);
  }
  return reasons;
}

function ghJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const expectedSha = process.env.VERIFIED_SHA;
  const evidencePath =
    process.argv[2] ?? ".infrastructure/evidence/manifest.json";
  const output =
    process.env.INFRASTRUCTURE_RELEASE_EVIDENCE ??
    "reports/infrastructure/release-evidence.json";

  if (!repository || !/^[a-f0-9]{40}$/i.test(expectedSha ?? "")) {
    throw new Error(
      "GITHUB_REPOSITORY and a 40-character VERIFIED_SHA are required",
    );
  }

  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const reasons =
    checkoutSha === expectedSha
      ? []
      : ["checked-out source does not match the verified SHA"];

  const [manifest, policy] = await Promise.all([
    readFile(evidencePath, "utf8").then(JSON.parse),
    readFile("verification/policy.json", "utf8").then(JSON.parse),
  ]);
  reasons.push(
    ...evaluateVerificationEvidence(
      manifest,
      expectedSha,
      policy.requiredChecks,
    ),
  );

  const pulls = ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/commits/${expectedSha}/pulls?per_page=100`,
  ])
    .flat()
    .filter((pull) => pull.merged_at);
  if (pulls.length === 0)
    reasons.push("deployment SHA must belong to a merged pull request");

  const evaluatedPulls = [];
  for (const pull of pulls) {
    const checkRuns = ghJson([
      "api",
      `repos/${repository}/commits/${pull.head.sha}/check-runs?check_name=${encodeURIComponent(checkName)}&per_page=100`,
    ]).check_runs;
    const trustedCheck = checkRuns
      .filter(
        (check) =>
          check.name === checkName &&
          check.app?.slug === "github-actions" &&
          check.external_id?.startsWith(
            `autonomous-integration:${pull.head.sha}:`,
          ),
      )
      .sort((left, right) => right.id - left.id)[0];
    if (
      trustedCheck?.status !== "completed" ||
      trustedCheck?.conclusion !== "success"
    ) {
      reasons.push(
        `merged pull request #${pull.number} lacks a trusted passing exact-head integration check`,
      );
    }
    evaluatedPulls.push({
      number: pull.number,
      headSha: pull.head.sha,
      trustedIntegrationCheckId: trustedCheck?.id,
      trusted:
        trustedCheck?.status === "completed" &&
        trustedCheck?.conclusion === "success",
    });
  }

  const result = {
    schemaVersion: 1,
    repository,
    deploymentSha: expectedSha,
    verificationRunId: process.env.VERIFICATION_RUN_ID,
    verificationEvidenceCommit: manifest.commit,
    pullRequests: evaluatedPulls,
    selfModificationAndCompatibilityEvidence:
      evaluatedPulls.length > 0 && evaluatedPulls.every((pull) => pull.trusted),
    allowed: reasons.length === 0,
    reasons,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.allowed) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-release.mjs")) await main();
