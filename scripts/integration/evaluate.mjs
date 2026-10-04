import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateIntegrationGate } from "../../packages/policy-engine/dist/index.js";
import { createDecisionCorrelation } from "../correlation.mjs";

const snapshotPath =
  process.env.INTEGRATION_SNAPSHOT ?? ".integration/snapshot.json";
const evidencePath =
  process.env.EVIDENCE_MANIFEST ?? ".integration/evidence/manifest.json";
const resultPath =
  process.env.INTEGRATION_RESULT ?? ".integration/policy-result.json";
const selfModificationPath =
  process.env.SELF_MODIFICATION_RESULT ??
  ".integration/self-modification-verdict.json";

const [snapshot, evidence, autonomyPolicy, evidencePolicy] = await Promise.all([
  readFile(snapshotPath, "utf8").then(JSON.parse),
  readFile(evidencePath, "utf8").then(JSON.parse),
  readFile(".github/autonomy/policy.json", "utf8").then(JSON.parse),
  readFile("verification/policy.json", "utf8").then(JSON.parse),
]);

const selfModificationVerdict = await readFile(selfModificationPath, "utf8")
  .then(JSON.parse)
  .catch(() => undefined);
const candidate = { ...snapshot, evidence, selfModificationVerdict };
const decision = evaluateIntegrationGate(
  {
    ...autonomyPolicy.integration,
    requiredEvidenceChecks: evidencePolicy.requiredChecks,
  },
  candidate,
);
const inputDigest = createHash("sha256")
  .update(JSON.stringify({ candidate, policy: autonomyPolicy.integration }))
  .digest("hex");
const unsigned = {
  schemaVersion: 1,
  repository: snapshot.repository,
  pullNumber: snapshot.pullNumber,
  goalNumber: snapshot.goalNumber,
  headSha: snapshot.headSha,
  evaluatedAt: new Date().toISOString(),
  workflowRunId: process.env.GITHUB_RUN_ID ?? "local",
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
  inputDigest,
  decision,
  correlation: createDecisionCorrelation({
    goalId: snapshot.goalNumber,
    pullRequest: snapshot.pullNumber,
    commitSha: snapshot.headSha,
    workflowRunId: process.env.GITHUB_RUN_ID,
    policyVerdict: decision.allowed ? "allow:integration" : "deny:integration",
  }),
};
const result = {
  ...unsigned,
  resultDigest: createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex"),
};

await mkdir(path.dirname(resultPath), { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  decision.allowed
    ? `Integration policy passed for ${snapshot.headSha}`
    : `Integration policy denied: ${decision.reasons.join("; ")}`,
);

if (process.env.GITHUB_OUTPUT) {
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `allowed=${decision.allowed}\nresult_digest=${result.resultDigest}\n`,
    { flag: "a" },
  );
}
if (!decision.allowed) process.exitCode = 1;
