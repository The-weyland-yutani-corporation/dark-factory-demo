import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const repository = process.env.GITHUB_REPOSITORY;
const pullNumber = Number(process.env.PR_NUMBER);
if (!repository || !Number.isInteger(pullNumber) || pullNumber <= 0) {
  throw new Error("GITHUB_REPOSITORY and PR_NUMBER are required");
}

function ghJson(args) {
  return JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", env: process.env }),
  );
}

const pull = ghJson(["api", `repos/${repository}/pulls/${pullNumber}`]);
const pullLabels = new Set(pull.labels.map((label) => label.name));
if (!pull.merged || !pullLabels.has("integration:ready")) {
  console.log(
    "Pull request was not merged by the autonomous integration path.",
  );
  process.exit(0);
}

const [owner, name] = repository.split("/");
const linked = ghJson([
  "api",
  "graphql",
  "-f",
  `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:10){nodes{number}}}}}`,
  "-f",
  `owner=${owner}`,
  "-f",
  `name=${name}`,
  "-F",
  `number=${pullNumber}`,
]).data.repository.pullRequest.closingIssuesReferences.nodes;
if (linked.length !== 1) {
  throw new Error(
    "merged integration pull request must close exactly one goal",
  );
}

const goalNumber = linked[0].number;
const goal = ghJson(["api", `repos/${repository}/issues/${goalNumber}`]);
const labels = goal.labels.map((label) => label.name);
if (
  !labels.includes("state:merging") ||
  labels.some((label) =>
    ["state:terminal", "repair:needed", "repair:exhausted"].includes(label),
  )
) {
  throw new Error("goal is not in a merge-completable state");
}

const policy = JSON.parse(
  await readFile(".github/autonomy/policy.json", "utf8"),
);
for (const label of labels) {
  if (
    policy.labels.exclusiveGroups.state.includes(label) &&
    label !== "state:completed"
  ) {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "DELETE",
        `repos/${repository}/issues/${goalNumber}/labels/${encodeURIComponent(label)}`,
      ],
      { stdio: "inherit", env: process.env },
    );
  }
}
execFileSync(
  "gh",
  [
    "api",
    "--method",
    "POST",
    `repos/${repository}/issues/${goalNumber}/labels`,
    "-f",
    "labels[]=state:completed",
  ],
  { stdio: "inherit", env: process.env },
);
console.log(`Goal #${goalNumber} reconciled to state:completed.`);
