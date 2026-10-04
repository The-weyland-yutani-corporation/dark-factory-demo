import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const repository = process.env.GITHUB_REPOSITORY;
const result = JSON.parse(
  await readFile(
    process.env.INTEGRATION_RESULT ?? ".integration/policy-result.json",
    "utf8",
  ),
);
const settings = JSON.parse(
  await readFile(".github/autonomy/repository-settings.json", "utf8"),
);
const autonomyPolicy = JSON.parse(
  await readFile(".github/autonomy/policy.json", "utf8"),
);

if (!repository || result.repository !== repository) {
  throw new Error("policy result repository does not match the workflow");
}
if (!result.decision.allowed || result.decision.headSha !== result.headSha) {
  throw new Error("policy result does not authorize integration");
}
const { resultDigest, ...unsigned } = result;
const calculatedDigest = createHash("sha256")
  .update(JSON.stringify(unsigned))
  .digest("hex");
if (
  resultDigest !== calculatedDigest ||
  result.workflowRunId !== process.env.GITHUB_RUN_ID
) {
  throw new Error("policy result integrity or workflow provenance is invalid");
}

function graphql(query, fields) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(fields)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${name}=${value}`);
  }
  return JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", env: process.env }),
  );
}

const [owner, name] = repository.split("/");
const current = graphql(
  `
    query ($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          id
          headRefOid
          merged
          mergeQueueEntry {
            id
          }
          autoMergeRequest {
            enabledAt
          }
        }
      }
    }
  `,
  { owner, name, number: result.pullNumber },
).data.repository.pullRequest;

if (current.headRefOid !== result.headSha) {
  throw new Error("pull request head changed after policy evaluation");
}
if (current.merged) {
  console.log("Pull request is already merged.");
} else if (settings.integrationMode === "merge_queue") {
  if (current.mergeQueueEntry) {
    console.log("Pull request is already in the merge queue.");
  } else {
    graphql(
      `
        mutation ($id: ID!) {
          enqueuePullRequest(input: { pullRequestId: $id }) {
            mergeQueueEntry {
              id
            }
          }
        }
      `,
      { id: current.id },
    );
    console.log("Pull request added to the merge queue.");
  }
} else if (current.autoMergeRequest) {
  console.log("Auto-merge is already enabled.");
} else {
  graphql(
    `
      mutation ($id: ID!) {
        enablePullRequestAutoMerge(
          input: { pullRequestId: $id, mergeMethod: SQUASH }
        ) {
          pullRequest {
            id
          }
        }
      }
    `,
    { id: current.id },
  );
  console.log("Auto-merge enabled.");
}

execFileSync(
  "gh",
  [
    "api",
    "--method",
    "POST",
    `repos/${repository}/issues/${result.pullNumber}/labels`,
    "-f",
    "labels[]=integration:ready",
  ],
  { stdio: "inherit", env: process.env },
);

const goal = JSON.parse(
  execFileSync(
    "gh",
    ["api", `repos/${repository}/issues/${result.goalNumber}`],
    { encoding: "utf8", env: process.env },
  ),
);
for (const label of goal.labels.map((item) => item.name)) {
  if (
    autonomyPolicy.labels.exclusiveGroups.state.includes(label) &&
    label !== "state:merging"
  ) {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "DELETE",
        `repos/${repository}/issues/${result.goalNumber}/labels/${encodeURIComponent(label)}`,
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
    `repos/${repository}/issues/${result.goalNumber}/labels`,
    "-f",
    "labels[]=state:merging",
  ],
  { stdio: "inherit", env: process.env },
);
