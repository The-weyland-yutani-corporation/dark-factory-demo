import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const apply = process.argv.includes("--apply");
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (apply && process.env.CONFIRM_GITHUB_RECONCILE !== repository) {
  throw new Error(
    "Set CONFIRM_GITHUB_RECONCILE to the exact repository before --apply",
  );
}

const [labels, ruleset, settings] = await Promise.all([
  readFile(".github/labels.yml", "utf8").then(parse),
  readFile(".github/autonomy/ruleset.json", "utf8").then(JSON.parse),
  readFile(".github/autonomy/repository-settings.json", "utf8").then(
    JSON.parse,
  ),
]);

function readApi(args) {
  return JSON.parse(
    execFileSync("gh", ["api", ...args], {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
}

const existingLabels = readApi([
  "--paginate",
  "--slurp",
  `repos/${repository}/labels?per_page=100`,
]).flat();
const existingRulesets = readApi([`repos/${repository}/rulesets`]);

function request(args, input) {
  if (!apply) {
    console.log(`[dry-run] gh ${args.join(" ")}`);
    return;
  }
  execFileSync("gh", args, {
    input: input ? `${JSON.stringify(input)}\n` : undefined,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    env: process.env,
  });
}

for (const label of labels) {
  const encoded = encodeURIComponent(label.name);
  const exists = existingLabels.some((item) => item.name === label.name);
  request(
    [
      "api",
      "--method",
      exists ? "PATCH" : "POST",
      exists
        ? `repos/${repository}/labels/${encoded}`
        : `repos/${repository}/labels`,
      "--input",
      "-",
    ],
    {
      name: label.name,
      color: label.color,
      description: label.description,
    },
  );
}

request(
  ["api", "--method", "PATCH", `repos/${repository}`, "--input", "-"],
  settings.repository,
);

const existingRulesetId = existingRulesets.find(
  (item) => item.name === ruleset.name,
)?.id;
request(
  [
    "api",
    "--method",
    existingRulesetId ? "PUT" : "POST",
    existingRulesetId
      ? `repos/${repository}/rulesets/${existingRulesetId}`
      : `repos/${repository}/rulesets`,
    "--input",
    "-",
  ],
  ruleset,
);

console.log(
  apply
    ? `Reconciled ${repository}.`
    : "Dry run only; no GitHub settings were changed.",
);
