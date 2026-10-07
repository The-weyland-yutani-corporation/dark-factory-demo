import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const environment = {
  deployment_branch_policy: null,
};
const reportsRoot = "reports/reconciliation";
const operations = [];

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
  operations.push({
    method: args[args.indexOf("--method") + 1] ?? "GET",
    path: args.find((item) => item.startsWith(`repos/${repository}`)),
    input,
  });
  if (!apply) {
    return;
  }
  execFileSync("gh", args, {
    input: input ? `${JSON.stringify(input)}\n` : undefined,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    env: process.env,
  });
}

function optionalApi(args) {
  try {
    return readApi(args);
  } catch {
    return null;
  }
}

async function captureState() {
  const [repositoryState, currentLabels, currentRulesets, production] =
    await Promise.all([
      Promise.resolve(readApi([`repos/${repository}`])),
      Promise.resolve(
        readApi([
          "--paginate",
          "--slurp",
          `repos/${repository}/labels?per_page=100`,
        ]).flat(),
      ),
      Promise.resolve(readApi([`repos/${repository}/rulesets`])),
      Promise.resolve(
        optionalApi([`repos/${repository}/environments/production`]),
      ),
    ]);
  const selectedRepository = Object.fromEntries(
    Object.keys(settings.repository).map((key) => [key, repositoryState[key]]),
  );
  const selectedRulesetSummary = currentRulesets.find(
    (item) => item.name === ruleset.name,
  );
  const selectedRuleset = selectedRulesetSummary
    ? readApi([`repos/${repository}/rulesets/${selectedRulesetSummary.id}`])
    : null;
  return {
    labels: labels.map((desired) => {
      const current = currentLabels.find((item) => item.name === desired.name);
      return current
        ? {
            name: current.name,
            color: current.color,
            description: current.description,
          }
        : null;
    }),
    production: production
      ? {
          name: production.name,
          protection_rules: production.protection_rules,
          deployment_branch_policy: production.deployment_branch_policy,
        }
      : null,
    repository: selectedRepository,
    ruleset: selectedRuleset
      ? {
          id: selectedRuleset.id,
          name: selectedRuleset.name,
          enforcement: selectedRuleset.enforcement,
          bypass_actors: selectedRuleset.bypass_actors,
          rules: selectedRuleset.rules,
        }
      : null,
  };
}

function converged(state) {
  const labelsMatch = state.labels.every(
    (current, index) =>
      current &&
      current.color.toLowerCase() === labels[index].color.toLowerCase() &&
      current.description === labels[index].description,
  );
  const repositoryMatches = Object.entries(settings.repository).every(
    ([key, value]) => state.repository[key] === value,
  );
  const environmentMatches =
    state.production &&
    (state.production.protection_rules ?? []).length === 0 &&
    state.production.deployment_branch_policy === null;
  const ruleTypes = new Set(state.ruleset?.rules?.map((rule) => rule.type));
  const desiredChecks = ruleset.rules.find(
    (rule) => rule.type === "required_status_checks",
  )?.parameters.required_status_checks;
  const currentChecks = state.ruleset?.rules?.find(
    (rule) => rule.type === "required_status_checks",
  )?.parameters.required_status_checks;
  const rulesetMatches =
    state.ruleset?.enforcement === "active" &&
    (state.ruleset.bypass_actors ?? []).length === 0 &&
    desiredChecks?.every((required) =>
      currentChecks?.some(
        (current) =>
          current.context === required.context &&
          current.integration_id === required.integration_id,
      ),
    ) &&
    [
      "deletion",
      "non_fast_forward",
      "required_status_checks",
      "merge_queue",
    ].every((type) => ruleTypes.has(type));
  return Boolean(
    labelsMatch && repositoryMatches && environmentMatches && rulesetMatches,
  );
}

const preState = await captureState();

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
  [
    "api",
    "--method",
    "PUT",
    `repos/${repository}/environments/production`,
    "--input",
    "-",
  ],
  environment,
);

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

const postState = apply ? await captureState() : preState;
const report = {
  schemaVersion: 1,
  operationKey: `${process.env.GOAL_KEY ?? "unspecified"}:reconcile:github:${process.env.CONTRACT_DIGEST ?? "unspecified"}`,
  repository,
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  sequence: ["labels", "production-environment", "merge-settings", "ruleset"],
  preConverged: converged(preState),
  converged: converged(postState),
  operations,
  preState,
  postState,
};
await mkdir(reportsRoot, { recursive: true });
const reportPath = `${reportsRoot}/${apply ? "applied-state" : "dry-run"}.json`;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (apply && !report.converged)
  throw new Error(`GitHub reconciliation did not converge; see ${reportPath}`);
console.log(`${apply ? "Applied" : "Planned"} reconciliation: ${reportPath}`);
