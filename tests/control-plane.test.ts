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

  it("retains hidden exact-head and security evidence for 30 days", async () => {
    const workflows = await Promise.all(
      ["ci.yml", "code-security.yml", "container-security.yml"].map((name) =>
        readFile(`.github/workflows/${name}`, "utf8"),
      ),
    );
    expect(workflows[0]).toContain("include-hidden-files: true");
    for (const workflow of workflows) {
      expect(workflow).toContain("retention-days: 30");
      expect(workflow).toContain("github.event.pull_request.head.sha");
    }
    expect(workflows[1]).toContain("dependency-audit.json");
    expect(workflows[1]).toContain("codeql-summary.json");
    expect(workflows[2]).toContain("filesystem.sarif");
    expect(workflows[2]).toContain("container.sarif");
  });

  it("reconciles controls in bootstrap-safe order with durable JSON", async () => {
    const script = await readFile("scripts/reconcile-github.mjs", "utf8");
    expect(script).toContain(
      '["labels", "production-environment", "merge-settings", "ruleset"]',
    );
    expect(script).toContain("reports/reconciliation");
    expect(script).toContain("preConverged");
    expect(script).toContain("converged");
    expect(script).toContain("dark-factory-reconcile:");
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

  it("deploys infrastructure only from trusted exact-main evidence", async () => {
    const workflow = await readFile(
      ".github/workflows/infrastructure.yml",
      "utf8",
    );
    expect(workflow).toContain('workflows: ["Deterministic verification"]');
    expect(workflow).toContain("github.event.workflow_run.head_sha");
    expect(workflow).toContain(
      "AZURE_RESOURCE_GROUP: ${{ vars.AZURE_RESOURCE_GROUP }}",
    );
    expect(workflow).toContain(
      "AZURE_SUBSCRIPTION_ID: ${{ vars.AZURE_SUBSCRIPTION_ID }}",
    );
    expect(workflow).toContain("infra/main.bicep");
    expect(workflow).toContain("infra/main.demo.bicepparam");
    expect(workflow).toContain("--mode Incremental");
    expect(workflow).toContain("guard-what-if.mjs");
    expect(workflow).toContain("id-token: write");
    expect(workflow).not.toContain("workflow_dispatch:");

    const policy = JSON.parse(
      await readFile(".github/autonomy/policy.json", "utf8"),
    ) as {
      integration: { deploymentPaths: string[] };
    };
    expect(policy.integration.deploymentPaths).toEqual(
      expect.arrayContaining([
        "infra",
        "scripts/infrastructure",
        ".github/workflows/infrastructure.yml",
      ]),
    );
  });

  it("confines Dark Factory Mage credentials to safe-output jobs", async () => {
    const files = await readdir(".github/workflows");
    const sources = files.filter((file) => file.endsWith(".md"));
    const locks = files.filter((file) => file.endsWith(".lock.yml"));

    for (const source of sources) {
      const content = await readFile(`.github/workflows/${source}`, "utf8");
      expect(content).toContain("copilot-requests: write");
      expect(content).toContain("github-app:");
      expect(content).toContain(
        "client-id: ${{ secrets.DARK_FACTORY_MAGE_APP_CLIENT_ID }}",
      );
      expect(content).toContain(
        "private-key: ${{ secrets.DARK_FACTORY_MAGE_APP_PRIVATE_KEY }}",
      );
      expect(content).not.toContain("secrets.GH_AW_GITHUB_TOKEN");
      expect(content).not.toContain("assign-to-agent:");
      expect(content).not.toContain("assign_to_agent");
    }

    for (const lock of locks) {
      const content = await readFile(`.github/workflows/${lock}`, "utf8");
      const safeOutputs = content.split(/\r?\n {2}safe_outputs:\r?\n/)[1] ?? "";
      expect(safeOutputs).toContain("DARK_FACTORY_MAGE_APP_PRIVATE_KEY");
      expect(content).not.toContain("secrets.GH_AW_GITHUB_TOKEN");
      expect(content).not.toContain("secrets.GH_AW_AGENT_TOKEN");
      expect(content).not.toContain("assign-to-agent");
      expect(content).not.toContain("assign_to_agent");
      const agentJob =
        content
          .split(/\r?\n {2}agent:\r?\n/)[1]
          ?.split(/\r?\n {2}\w+:\r?\n/)[0] ?? "";
      expect(agentJob).not.toContain("DARK_FACTORY_MAGE_APP_PRIVATE_KEY");
    }

    const maintenance = await readFile(
      ".github/workflows/agentics-maintenance.yml",
      "utf8",
    );
    const replayJob =
      maintenance
        .split(/\r?\n {2}apply_safe_outputs:\r?\n/)[1]
        ?.split(/\r?\n {2}create_labels:\r?\n/)[0] ?? "";
    expect(replayJob).toContain("actions/create-github-app-token@");
    expect(replayJob).toContain(
      "private-key: ${{ secrets.DARK_FACTORY_MAGE_APP_PRIVATE_KEY }}",
    );
    expect(replayJob).toContain(
      "github-token: ${{ steps.replay-token.outputs.token }}",
    );
    expect(replayJob).not.toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(maintenance).not.toContain("secrets.GH_AW_GITHUB_TOKEN");
  });

  it("uses App-authenticated code-writing outputs for implementation and repair", async () => {
    const implementation = await readFile(
      ".github/workflows/coding-agent-assignment.md",
      "utf8",
    );
    expect(implementation).toContain("create-pull-request:");
    expect(implementation).toContain(
      "github-token-for-extra-empty-commit: app",
    );
    expect(implementation).toContain("protected-files: request_review");
    expect(implementation).toContain("allow-workflows: true");
    expect(implementation).toContain(".github/agents/implementer.agent.md");

    const repair = await readFile(
      ".github/workflows/bounded-repair-routing.md",
      "utf8",
    );
    expect(repair).toContain("push-to-pull-request-branch:");
    expect(repair).toContain('target: "*"');
    expect(repair).toContain("fallback-as-pull-request: false");
    expect(repair).toContain("github-token-for-extra-empty-commit: app");
    expect(repair).toContain("protected-files: allowed");
    expect(repair).toContain(".github/agents/implementer.agent.md");

    for (const [lockName, outputType] of [
      ["coding-agent-assignment.lock.yml", "create_pull_request"],
      ["bounded-repair-routing.lock.yml", "push_to_pull_request_branch"],
    ]) {
      const lock = await readFile(`.github/workflows/${lockName}`, "utf8");
      expect(lock).toContain(outputType);
      expect(lock).toContain("permission-contents: write");
      expect(lock).toContain("permission-workflows: write");
      expect(lock).toContain(
        "GH_AW_CI_TRIGGER_TOKEN: ${{ steps.safe-outputs-app-token.outputs.token || '' }}",
      );
      expect(lock).not.toMatch(/GH_AW_CI_TRIGGER_TOKEN:\s*\$\{\{\s*secrets\./);
    }
  });
});
