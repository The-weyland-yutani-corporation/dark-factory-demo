import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repository = process.env.GITHUB_REPOSITORY;
const headSha = process.env.HEAD_SHA;
const output = process.env.INTEGRATION_SNAPSHOT ?? ".integration/snapshot.json";

if (!repository || !headSha) {
  throw new Error("GITHUB_REPOSITORY and HEAD_SHA are required");
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

function ghPages(endpoint) {
  return ghJson(["api", "--paginate", "--slurp", endpoint]).flat();
}

let pullNumber = Number(process.env.PR_NUMBER);
if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
  const [owner, name] = repository.split("/");
  const associated = ghJson([
    "api",
    "graphql",
    "-f",
    `query=query($owner:String!,$name:String!,$sha:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$sha){... on Commit{associatedPullRequests(first:10){nodes{number state headRefOid}}}}}}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `sha=${headSha}`,
  ]).data.repository.object.associatedPullRequests.nodes;
  const matching = associated.filter(
    (pull) => pull.state === "OPEN" && pull.headRefOid === headSha,
  );
  if (matching.length !== 1) {
    throw new Error(`expected one open pull request for ${headSha}`);
  }
  pullNumber = matching[0].number;
}

const pull = ghJson(["api", `repos/${repository}/pulls/${pullNumber}`]);
if (pull.head.sha !== headSha) {
  throw new Error(
    `pull request head changed from ${headSha} to ${pull.head.sha}`,
  );
}

const files = ghPages(
  `repos/${repository}/pulls/${pullNumber}/files?per_page=100`,
);
const reviews = ghPages(
  `repos/${repository}/pulls/${pullNumber}/reviews?per_page=100`,
);
const checkRuns = ghJson([
  "api",
  "--paginate",
  "--slurp",
  `repos/${repository}/commits/${headSha}/check-runs?per_page=100`,
]).flatMap((page) => page.check_runs);
const linked = ghJson([
  "api",
  "graphql",
  "-f",
  `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:10){nodes{number labels(first:100){nodes{name}}}}}}}`,
  "-F",
  `owner=${repository.split("/")[0]}`,
  "-F",
  `name=${repository.split("/")[1]}`,
  "-F",
  `number=${pullNumber}`,
]);

const goalIssues =
  linked.data.repository.pullRequest.closingIssuesReferences.nodes;
if (goalIssues.length !== 1) {
  throw new Error("pull request must close exactly one goal issue");
}

const snapshot = {
  pullNumber,
  pullNodeId: pull.node_id,
  headSha,
  author: pull.user.login,
  labels: pull.labels.map((label) => label.name).sort(),
  goalNumber: goalIssues[0].number,
  goalLabels: goalIssues[0].labels.nodes.map((label) => label.name).sort(),
  changedFiles: files.map((file) => file.filename).sort(),
  checks: checkRuns
    .map((check) => ({
      id: check.id,
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      completedAt: check.completed_at,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)),
  reviews: reviews
    .map((review) => ({
      author: review.user.login,
      state: review.state,
      commitId: review.commit_id,
      submittedAt: review.submitted_at,
    }))
    .sort((left, right) =>
      (left.submittedAt ?? "").localeCompare(right.submittedAt ?? ""),
    ),
  collectedAt: new Date().toISOString(),
  repository,
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  const current = await readFile(process.env.GITHUB_OUTPUT, "utf8").catch(
    () => "",
  );
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `${current}pull_number=${pullNumber}\ngoal_number=${snapshot.goalNumber}\n`,
  );
}
