import { createSign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = ".github/workflows";
const files = await readdir(root);
const sources = files.filter((file) => file.endsWith(".md")).sort();
const locks = files.filter((file) => file.endsWith(".lock.yml")).sort();
const errors = [];
const appAction =
  "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1";

for (const source of sources) {
  const content = await readFile(`${root}/${source}`, "utf8");
  for (const expected of [
    "copilot-requests: write",
    "github-app:",
    "client-id: ${{ secrets.DARK_FACTORY_MAGE_APP_CLIENT_ID }}",
    "private-key: ${{ secrets.DARK_FACTORY_MAGE_APP_PRIVATE_KEY }}",
  ]) {
    if (!content.includes(expected)) {
      errors.push(`${source} is missing ${expected}`);
    }
  }
  if (content.includes("secrets.GH_AW_GITHUB_TOKEN")) {
    errors.push(`${source} retains the retired PAT credential`);
  }
  if (
    content.includes("assign-to-agent:") ||
    content.includes("assign_to_agent")
  ) {
    errors.push(
      `${source} uses assign-to-agent, which is not App-authenticated`,
    );
  }
}

for (const lock of locks) {
  const content = await readFile(`${root}/${lock}`, "utf8");
  const safeOutputJob = content.split(/\r?\n {2}safe_outputs:\r?\n/)[1] ?? "";
  const agentJob =
    content
      .split(/\r?\n {2}agent:\r?\n/)[1]
      ?.split(/\r?\n {2}[A-Za-z0-9_-]+:\r?\n/)[0] ?? "";
  if (!safeOutputJob.includes("DARK_FACTORY_MAGE_APP_PRIVATE_KEY")) {
    errors.push(`${lock} does not mint a GitHub App safe-output token`);
  }
  if (agentJob.includes("DARK_FACTORY_MAGE_APP_PRIVATE_KEY")) {
    errors.push(`${lock} exposes the App private key to the reasoning job`);
  }
  if (
    content.includes("secrets.GH_AW_GITHUB_TOKEN") ||
    content.includes("secrets.GH_AW_AGENT_TOKEN")
  ) {
    errors.push(`${lock} retains a GH_AW_GITHUB_TOKEN fallback`);
  }
  if (
    content.includes("assign-to-agent") ||
    content.includes("assign_to_agent")
  ) {
    errors.push(`${lock} contains assign-to-agent output`);
  }
}

const implementationSource = await readFile(
  `${root}/coding-agent-assignment.md`,
  "utf8",
);
for (const expected of [
  "create-pull-request:",
  "github-token-for-extra-empty-commit: app",
  "protected-files: request_review",
  "allow-workflows: true",
]) {
  if (!implementationSource.includes(expected)) {
    errors.push(`coding-agent-assignment.md is missing ${expected}`);
  }
}

const repairSource = await readFile(
  `${root}/bounded-repair-routing.md`,
  "utf8",
);
for (const expected of [
  "push-to-pull-request-branch:",
  'target: "*"',
  "fallback-as-pull-request: false",
  "github-token-for-extra-empty-commit: app",
  "protected-files: allowed",
  "allow-workflows: true",
]) {
  if (!repairSource.includes(expected)) {
    errors.push(`bounded-repair-routing.md is missing ${expected}`);
  }
}

for (const [lockName, outputType] of [
  ["coding-agent-assignment.lock.yml", "create_pull_request"],
  ["bounded-repair-routing.lock.yml", "push_to_pull_request_branch"],
]) {
  const content = await readFile(`${root}/${lockName}`, "utf8");
  for (const expected of [
    outputType,
    "permission-contents: write",
    "permission-workflows: write",
    "GH_AW_CI_TRIGGER_TOKEN: ${{ steps.safe-outputs-app-token.outputs.token || '' }}",
  ]) {
    if (!content.includes(expected)) {
      errors.push(`${lockName} is missing ${expected}`);
    }
  }
  if (/GH_AW_CI_TRIGGER_TOKEN:\s*\$\{\{\s*secrets\./.test(content)) {
    errors.push(`${lockName} uses a PAT/secret CI trigger fallback`);
  }
}

const maintenance = await readFile(
  `${root}/agentics-maintenance.yml`,
  "utf8",
).catch(() => "");
const replayJob =
  maintenance
    .split(/\r?\n {2}apply_safe_outputs:\r?\n/)[1]
    ?.split(/\r?\n {2}create_labels:\r?\n/)[0] ?? "";
if (
  !replayJob.includes(appAction) ||
  !replayJob.includes("DARK_FACTORY_MAGE_APP_PRIVATE_KEY") ||
  !replayJob.includes("github-token: ${{ steps.replay-token.outputs.token }}")
) {
  errors.push(
    "agentics-maintenance.yml does not use a repository-scoped App token for replay",
  );
}

for (const workflow of [
  "autonomous-integration.yml",
  "autonomous-integration-complete.yml",
  "incident-operations.yml",
  "production.yml",
  "rollback.yml",
]) {
  const content = await readFile(`${root}/${workflow}`, "utf8");
  if (
    !content.includes(appAction) ||
    !content.includes("repositories: ${{ github.event.repository.name }}")
  ) {
    errors.push(`${workflow} does not mint a repository-scoped App token`);
  }
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function validateRuntime() {
  const clientId = process.env.DARK_FACTORY_MAGE_APP_CLIENT_ID?.trim();
  const privateKeyPath =
    process.env.DARK_FACTORY_MAGE_APP_PRIVATE_KEY_PATH?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!clientId || !privateKeyPath || !repository) {
    errors.push(
      "DARK_FACTORY_MAGE_APP_CLIENT_ID, DARK_FACTORY_MAGE_APP_PRIVATE_KEY_PATH, and GITHUB_REPOSITORY are required for runtime validation",
    );
    return;
  }
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra) {
    errors.push("GITHUB_REPOSITORY must use owner/repository form");
    return;
  }

  try {
    const privateKey = await readFile(privateKeyPath, "utf8");
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const jwt = `${header}.${payload}.${signer.sign(privateKey, "base64url")}`;
    const appHeaders = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": "2022-11-28",
    };
    const installationResponse = await fetch(
      `https://api.github.com/repos/${owner}/${name}/installation`,
      { headers: appHeaders },
    );
    if (!installationResponse.ok) {
      throw new Error(
        `installation lookup returned ${installationResponse.status}`,
      );
    }
    const installation = await installationResponse.json();
    const tokenResponse = await fetch(
      `https://api.github.com/app/installations/${installation.id}/access_tokens`,
      {
        method: "POST",
        headers: {
          ...appHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositories: [name],
          permissions: {
            actions: "write",
            contents: "write",
            deployments: "write",
            issues: "write",
            pull_requests: "write",
            workflows: "write",
          },
        }),
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(`token mint returned ${tokenResponse.status}`);
    }
    const token = await tokenResponse.json();
    const repositoryResponse = await fetch(
      `https://api.github.com/repos/${owner}/${name}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token.token}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!repositoryResponse.ok) {
      throw new Error(
        `repository access returned ${repositoryResponse.status}`,
      );
    }
  } catch (error) {
    errors.push(
      `Dark Factory Mage runtime validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (process.argv.includes("--runtime")) await validateRuntime();

if (errors.length > 0) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
} else {
  console.log(
    `Validated Dark Factory Mage boundaries for ${sources.length} agentic workflows.`,
  );
}
