import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Mutation {
  name: string;
  file: string;
  replacements: Array<[string, string]>;
  error: string;
}

const validator = resolve("scripts", "validate-agentic-credentials.mjs");
const workflowRoot = resolve(".github", "workflows");
const workflows = await Promise.all(
  (await readdir(workflowRoot))
    .filter((name) => /\.(md|yml)$/.test(name))
    .map(async (name) => ({
      name,
      content: (await readFile(join(workflowRoot, name), "utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
    })),
);
const offlineGuard = `data:text/javascript,${encodeURIComponent(
  "globalThis.fetch = () => { throw new Error('Unexpected network request during static validation'); };",
)}`;

async function validateFixture(eol: string, mutation?: Mutation) {
  const directory = await mkdtemp(join(tmpdir(), "dark-factory-credentials-"));
  try {
    const root = join(directory, ".github", "workflows");
    await mkdir(root, { recursive: true });
    if (mutation) {
      expect(workflows.map(({ name }) => name)).toContain(mutation.file);
    }
    for (const workflow of workflows) {
      let content = workflow.content;
      if (workflow.name === mutation?.file) {
        for (const [before, after] of mutation.replacements) {
          expect(content).toContain(before);
          content = content.replaceAll(before, after);
        }
      }
      await writeFile(join(root, workflow.name), content.replaceAll("\n", eol));
    }
    const result = spawnSync(
      process.execPath,
      ["--import", offlineGuard, validator],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 5_000,
        env: {
          ...process.env,
          DARK_FACTORY_MAGE_APP_CLIENT_ID: "",
          DARK_FACTORY_MAGE_APP_PRIVATE_KEY: "",
          DARK_FACTORY_MAGE_APP_PRIVATE_KEY_PATH: "",
          GITHUB_REPOSITORY: "",
        },
      },
    );
    if (result.error) throw result.error;
    expect(result.signal).toBeNull();
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const appKey = "DARK_FACTORY_MAGE_APP_PRIVATE_KEY";
const replayToken = "github-token: ${{ steps.replay-token.outputs.token }}";
const invalidFixtures: Mutation[] = [
  {
    name: "missing safe-output App key",
    file: "goal-intake.lock.yml",
    replacements: [[appKey, "MISSING_APP_KEY"]],
    error: "does not mint a GitHub App safe-output token",
  },
  {
    name: "App key in the reasoning job",
    file: "goal-intake.lock.yml",
    replacements: [
      [
        "\n    env:\n      DEFAULT_BRANCH:",
        "\n    env:\n      APP_KEY: ${{ secrets.DARK_FACTORY_MAGE_APP_PRIVATE_KEY }}\n      DEFAULT_BRANCH:",
      ],
    ],
    error: "exposes the App private key to the reasoning job",
  },
  ...["GH_AW_GITHUB_TOKEN", "GH_AW_AGENT_TOKEN"].map((token): Mutation => ({
    name: `retired ${token} fallback`,
    file: "goal-intake.lock.yml",
    replacements: [["secrets.GITHUB_TOKEN", `secrets.${token}`]],
    error: "retains a GH_AW_GITHUB_TOKEN fallback",
  })),
  {
    name: "secret-based CI trigger fallback",
    file: "coding-agent-assignment.lock.yml",
    replacements: [
      [
        "GH_AW_CI_TRIGGER_TOKEN: ${{ steps.safe-outputs-app-token.outputs.token || '' }}",
        "GH_AW_CI_TRIGGER_TOKEN: ${{ secrets.CI_TOKEN }}",
      ],
    ],
    error: "uses a PAT/secret CI trigger fallback",
  },
  {
    name: "prohibited agent assignment",
    file: "goal-intake.md",
    replacements: [
      [
        "copilot-requests: write",
        "copilot-requests: write\nassign-to-agent: {}",
      ],
    ],
    error: "uses assign-to-agent, which is not App-authenticated",
  },
  {
    name: "missing maintenance replay App key",
    file: "agentics-maintenance.yml",
    replacements: [[appKey, "MISSING_APP_KEY"]],
    error: "does not use a repository-scoped App token for replay",
  },
  {
    name: "missing maintenance replay token binding",
    file: "agentics-maintenance.yml",
    replacements: [[replayToken, "github-token: ${{ secrets.GITHUB_TOKEN }}"]],
    error: "does not use a repository-scoped App token for replay",
  },
  {
    name: "replay token reference only in the following job",
    file: "agentics-maintenance.yml",
    replacements: [
      [replayToken, "github-token: ${{ secrets.GITHUB_TOKEN }}"],
      ["\n  create_labels:\n", `\n  create_labels:\n    # ${replayToken}\n`],
    ],
    error: "does not use a repository-scoped App token for replay",
  },
];

describe.each([
  ["LF", "\n"],
  ["CRLF", "\r\n"],
])("Static credential validation with %s workflows", (_name, eol) => {
  it("accepts existing boundaries without credentials or network access", async () => {
    const result = await validateFixture(eol);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Validated Dark Factory Mage boundaries");
  });

  it.each(invalidFixtures)("rejects $name", async (mutation) => {
    const result = await validateFixture(eol, mutation);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${mutation.file} ${mutation.error}`);
    expect(result.stdout).not.toContain(
      "Validated Dark Factory Mage boundaries",
    );
  });
});
