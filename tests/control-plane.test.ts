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

  it("keeps required checks in one PR and merge-group run within the run budget", async () => {
    const [ci, codeSecurity, containerSecurity] = await Promise.all(
      ["ci.yml", "code-security.yml", "container-security.yml"].map((name) =>
        readFile(`.github/workflows/${name}`, "utf8"),
      ),
    );
    for (const job of ["verify", "dependency-security", "codeql", "trivy"]) {
      expect(ci).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    expect(ci).toMatch(/^  pull_request:/m);
    expect(ci).toMatch(/^  merge_group:/m);
    expect(ci).not.toMatch(/^  push:/m);

    for (const workflow of [codeSecurity, containerSecurity]) {
      expect(workflow).not.toMatch(/^  push:/m);
      expect(workflow).not.toMatch(/^  pull_request:/m);
      expect(workflow).not.toMatch(/^  merge_group:/m);
      expect(workflow).toMatch(/^  schedule:/m);
      expect(workflow).toMatch(/^  workflow_dispatch:/m);
    }

    const reservedRuns = {
      pullRequestVerification: 1,
      platformManagedPullRequestChecks: 2,
      independentReview: 1,
      postReviewIntegration: 1,
      mergeGroupVerification: 1,
      postMergeCompletion: 1,
    };
    const runCount = Object.values(reservedRuns).reduce(
      (total, count) => total + count,
      0,
    );
    const policy = JSON.parse(
      await readFile(".github/autonomy/policy.json", "utf8"),
    ) as { budgets: { global: { maxWorkflowRunsPerGoal: number } } };
    expect(runCount).toBe(7);
    expect(runCount).toBeLessThanOrEqual(
      policy.budgets.global.maxWorkflowRunsPerGoal,
    );
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

  it("publishes merge-group evidence from CI and retains review-triggered integration", async () => {
    const [ci, integration] = await Promise.all([
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile(".github/workflows/autonomous-integration.yml", "utf8"),
    ]);
    expect(ci).toContain("  merge_group:");
    expect(ci).toContain("  merge-group:");
    expect(ci).toContain("checks: write");
    expect(ci).toContain("scripts/integration/validate-merge-group.mjs");
    expect(ci).toContain("scripts/integration/publish-check.mjs");
    expect(ci).toContain("GITHUB_CHECK_TOKEN: ${{ github.token }}");
    expect(integration).toContain("workflow_run:");
    expect(integration).toContain(
      'workflows: ["Independent pull request review"]',
    );
    expect(integration).not.toMatch(/^  merge_group:/m);
    expect(integration).not.toMatch(/^  merge-group:/m);

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
