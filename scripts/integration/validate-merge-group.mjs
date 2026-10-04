import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const repository = process.env.GITHUB_REPOSITORY;
const mergeGroupSha = process.env.MERGE_GROUP_SHA;
const output =
  process.env.MERGE_GROUP_RESULT ?? ".integration/merge-group-result.json";
const checkName = "autonomous-integration/evidence";

if (!repository || !mergeGroupSha) {
  throw new Error("GITHUB_REPOSITORY and MERGE_GROUP_SHA are required");
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

const pulls = ghJson([
  "api",
  "--paginate",
  "--slurp",
  `repos/${repository}/commits/${mergeGroupSha}/pulls?per_page=100`,
]).flat();
const candidates = [
  ...new Map(
    pulls
      .filter((pull) => pull.state === "open")
      .map((pull) => [pull.number, pull]),
  ).values(),
];
const reasons = [];
const evaluatedPulls = [];

if (candidates.length === 0) {
  reasons.push("merge group has no associated open pull requests");
}

for (const pull of candidates) {
  const checks = ghJson([
    "api",
    `repos/${repository}/commits/${pull.head.sha}/check-runs?check_name=${encodeURIComponent(checkName)}&per_page=100`,
  ]).check_runs;
  const trustedChecks = checks
    .filter(
      (check) =>
        check.name === checkName &&
        check.app?.slug === "github-actions" &&
        check.external_id?.startsWith(
          `autonomous-integration:${pull.head.sha}:`,
        ),
    )
    .sort((left, right) => right.id - left.id);
  const trusted =
    trustedChecks[0]?.status === "completed" &&
    trustedChecks[0]?.conclusion === "success";
  if (!trusted) {
    reasons.push(
      `pull request #${pull.number} lacks a trusted passing exact-head integration check`,
    );
  }

  const [owner, name] = repository.split("/");
  const linked = ghJson([
    "api",
    "graphql",
    "-f",
    "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:10){nodes{number labels(first:100){nodes{name}}}}}}}",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${pull.number}`,
  ]).data.repository.pullRequest.closingIssuesReferences.nodes;
  if (linked.length !== 1) {
    reasons.push(
      `pull request #${pull.number} must close exactly one goal issue`,
    );
  } else {
    const labels = new Set(linked[0].labels.nodes.map((label) => label.name));
    if (!labels.has("state:reviewed") && !labels.has("state:merging")) {
      reasons.push(
        `goal #${linked[0].number} is not in a queue-eligible lifecycle state for pull request #${pull.number}`,
      );
    }
    for (const blocking of [
      "repair:needed",
      "repair:exhausted",
      "state:terminal",
      "autonomy:paused",
      "deployment:incompatible",
    ]) {
      if (labels.has(blocking)) {
        reasons.push(
          `goal #${linked[0].number} has blocking label ${blocking}`,
        );
      }
    }
  }

  evaluatedPulls.push({
    number: pull.number,
    headSha: pull.head.sha,
    trustedExactHeadCheck: trusted,
  });
}

const result = {
  schemaVersion: 1,
  mergeGroupSha,
  evaluatedPulls,
  allowed: reasons.length === 0,
  reasons,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.allowed) process.exitCode = 1;
