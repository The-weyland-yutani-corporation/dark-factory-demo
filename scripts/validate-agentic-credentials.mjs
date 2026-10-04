import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

const root = ".github/workflows";
const files = await readdir(root);
const sources = files.filter((file) => file.endsWith(".md")).sort();
const locks = files.filter((file) => file.endsWith(".lock.yml")).sort();
const errors = [];

for (const source of sources) {
  const content = await readFile(`${root}/${source}`, "utf8");
  if (!content.includes("github-token: ${{ secrets.GH_AW_GITHUB_TOKEN }}")) {
    errors.push(`${source} does not pin safe outputs to GH_AW_GITHUB_TOKEN`);
  }
  if (!content.includes("Require event-producing lifecycle credential")) {
    errors.push(`${source} does not fail fast when the credential is absent`);
  }
}

for (const lock of locks) {
  const content = await readFile(`${root}/${lock}`, "utf8");
  const safeOutputJob = content.split(/\n {2}safe_outputs:\n/)[1] ?? "";
  if (
    safeOutputJob.includes(
      "github-token: ${{ secrets.GH_AW_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}",
    )
  ) {
    errors.push(`${lock} permits a GITHUB_TOKEN safe-output fallback`);
  }
  if (
    safeOutputJob.includes(
      "GH_AW_ASSIGN_TO_AGENT_TOKEN: ${{ secrets.GH_AW_AGENT_TOKEN || secrets.GH_AW_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}",
    )
  ) {
    errors.push(`${lock} permits a GITHUB_TOKEN assignment fallback`);
  }
}

const maintenance = await readFile(
  `${root}/agentics-maintenance.yml`,
  "utf8",
).catch(() => "");
const replayJob =
  maintenance
    .split(/\n {2}apply_safe_outputs:\n/)[1]
    ?.split(/\n {2}create_labels:\n/)[0] ?? "";
if (
  !replayJob.includes("github-token: ${{ secrets.GH_AW_GITHUB_TOKEN }}") ||
  replayJob.includes("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}")
) {
  errors.push(
    "agentics-maintenance.yml does not require the event-producing token for safe-output replay",
  );
}

if (process.argv.includes("--runtime")) {
  const token = process.env.GH_AW_GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token) {
    errors.push("GH_AW_GITHUB_TOKEN is required for runtime validation");
  } else if (!repository) {
    errors.push("GITHUB_REPOSITORY is required for runtime validation");
  } else {
    try {
      execFileSync("gh", ["api", `repos/${repository}`], {
        env: { ...process.env, GH_TOKEN: token },
        stdio: "ignore",
      });
    } catch {
      errors.push("GH_AW_GITHUB_TOKEN cannot access the configured repository");
    }
  }
}

if (errors.length > 0) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
} else {
  console.log(
    `Validated event-producing credentials for ${sources.length} agentic workflows.`,
  );
}
