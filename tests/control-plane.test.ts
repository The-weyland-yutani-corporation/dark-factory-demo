import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface Ruleset {
  rules: Array<{
    type: string;
    parameters?: {
      required_status_checks?: Array<{
        context: string;
        integration_id?: number;
      }>;
    };
  }>;
}

describe("GitHub integration control plane", () => {
  it("requires the trusted exact-head gate and security checks", async () => {
    const ruleset = JSON.parse(
      await readFile(".github/autonomy/ruleset.json", "utf8"),
    ) as Ruleset;
    const required = ruleset.rules.find(
      (rule) => rule.type === "required_status_checks",
    )?.parameters?.required_status_checks;

    expect(required).toEqual(
      expect.arrayContaining([
        { context: "verify" },
        { context: "dependency-security" },
        { context: "codeql" },
        { context: "trivy" },
        {
          context: "autonomous-integration/evidence",
          integration_id: 15368,
        },
      ]),
    );
  });

  it("publishes the integration context for pull heads and merge groups", async () => {
    const workflow = await readFile(
      ".github/workflows/autonomous-integration.yml",
      "utf8",
    );
    expect(workflow).toContain("merge_group:");
    expect(workflow).toContain("types: [checks_requested]");
    expect(workflow).toContain("checks: write");
    expect(workflow).toContain("  merge-group:");

    const publisher = await readFile(
      "scripts/integration/publish-check.mjs",
      "utf8",
    );
    expect(publisher).toContain("autonomous-integration/evidence");
  });

  it("confines Dark Factory Mage credentials to safe-output jobs", async () => {
    const files = await readdir(".github/workflows");
    const sources = files.filter((file) => file.endsWith(".md"));
    const locks = files.filter((file) => file.endsWith(".lock.yml"));

    for (const source of sources) {
      const content = await readFile(`.github/workflows/${source}`, "utf8");
      expect(content).toContain("copilot-requests: write");
      expect(content).toContain("github-app:");
      expect(content).toContain("app-id: ${{ vars.DARK_FACTORY_MAGE_APP_ID }}");
      expect(content).toContain(
        "private-key: ${{ secrets.DARK_FACTORY_MAGE_PRIVATE_KEY }}",
      );
      expect(content).not.toContain("secrets.GH_AW_GITHUB_TOKEN");
    }

    for (const lock of locks) {
      const content = await readFile(`.github/workflows/${lock}`, "utf8");
      const safeOutputs = content.split(/\n {2}safe_outputs:\n/)[1] ?? "";
      expect(safeOutputs).toContain("DARK_FACTORY_MAGE_PRIVATE_KEY");
      expect(content).not.toContain("secrets.GH_AW_GITHUB_TOKEN");
      expect(content).not.toContain("secrets.GH_AW_AGENT_TOKEN");
      const agentJob =
        content.split(/\n {2}agent:\n/)[1]?.split(/\n {2}\w+:\n/)[0] ?? "";
      expect(agentJob).not.toContain("DARK_FACTORY_MAGE_PRIVATE_KEY");
    }

    const maintenance = await readFile(
      ".github/workflows/agentics-maintenance.yml",
      "utf8",
    );
    const replayJob =
      maintenance
        .split(/\n {2}apply_safe_outputs:\n/)[1]
        ?.split(/\n {2}create_labels:\n/)[0] ?? "";
    expect(replayJob).toContain("actions/create-github-app-token@");
    expect(replayJob).toContain(
      "private-key: ${{ secrets.DARK_FACTORY_MAGE_PRIVATE_KEY }}",
    );
    expect(replayJob).toContain(
      "github-token: ${{ steps.replay-token.outputs.token }}",
    );
    expect(replayJob).not.toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(maintenance).not.toContain("secrets.GH_AW_GITHUB_TOKEN");
  });
});
