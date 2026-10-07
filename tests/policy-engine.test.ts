import type { PolicyContext, PolicyRule } from "@dark-factory/contracts";
import {
  evaluateIntegrationGate,
  evaluatePolicy,
  type IntegrationCandidate,
  type IntegrationPolicy,
} from "@dark-factory/policy-engine";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

const context: PolicyContext = {
  subject: "deployment-agent",
  resource: "production",
  attributes: {
    region: "eastus",
    risk: "low",
  },
};

describe("evaluatePolicy", () => {
  it("selects the highest-priority matching rule deterministically", () => {
    const rules: PolicyRule[] = [
      {
        id: "allow-low-risk",
        description: "Low-risk deployments are allowed",
        action: "allow",
        priority: 10,
        conditions: { risk: "low" },
      },
      {
        id: "deny-production",
        description: "Production requires an explicit exception",
        action: "deny",
        priority: 100,
        conditions: { resource: "production" },
      },
    ];

    expect(evaluatePolicy({ rules, defaultAction: "deny" }, context)).toEqual({
      action: "deny",
      matchedRuleId: "deny-production",
      reason: "Production requires an explicit exception",
    });
  });

  it("uses rule id as a stable tie-breaker without mutating input", () => {
    const rules: PolicyRule[] = [
      {
        id: "z-rule",
        description: "Second by id",
        action: "deny",
        priority: 10,
        conditions: { region: "eastus" },
      },
      {
        id: "a-rule",
        description: "First by id",
        action: "allow",
        priority: 10,
        conditions: { region: "eastus" },
      },
    ];

    const decision = evaluatePolicy({ rules, defaultAction: "deny" }, context);

    expect(decision.matchedRuleId).toBe("a-rule");
    expect(rules.map((rule) => rule.id)).toEqual(["z-rule", "a-rule"]);
  });

  it("falls back to the configured default action", () => {
    expect(
      evaluatePolicy({ rules: [], defaultAction: "deny" }, context),
    ).toEqual({
      action: "deny",
      matchedRuleId: null,
      reason: "No rule matched; applied default deny action",
    });
  });

  it("matches subject and resource conditions", () => {
    const rules: PolicyRule[] = [
      {
        id: "subject-resource",
        description: "Exact actor and target",
        action: "allow",
        priority: 1,
        conditions: {
          subject: "deployment-agent",
          resource: "production",
        },
      },
    ];

    expect(
      evaluatePolicy({ rules, defaultAction: "deny" }, context).action,
    ).toBe("allow");
    expect(
      evaluatePolicy(
        { rules, defaultAction: "deny" },
        { ...context, subject: "other-agent" },
      ).action,
    ).toBe("deny");
    expect(
      evaluatePolicy(
        { rules, defaultAction: "deny" },
        { ...context, resource: "staging" },
      ).action,
    ).toBe("deny");
  });

  it("requires every attribute condition to match", () => {
    const rules: PolicyRule[] = [
      {
        id: "multi-condition",
        description: "All attributes match",
        action: "allow",
        priority: 1,
        conditions: { region: "eastus", risk: "low" },
      },
    ];

    expect(
      evaluatePolicy(
        { rules, defaultAction: "deny" },
        { ...context, attributes: { region: "eastus", risk: "high" } },
      ).action,
    ).toBe("deny");
  });

  it("handles duplicate sort keys deterministically", () => {
    const duplicate: PolicyRule = {
      id: "same",
      description: "Same rule",
      action: "allow",
      priority: 1,
      conditions: {},
    };

    expect(
      evaluatePolicy(
        { rules: [duplicate, duplicate], defaultAction: "deny" },
        context,
      ).matchedRuleId,
    ).toBe("same");
  });
});

const integrationPolicy: IntegrationPolicy = {
  requiredChecks: ["verify", "codeql"],
  requiredEvidenceChecks: ["format", "unit"],
  reviewedStateLabel: "state:reviewed",
  blockingLabels: [
    "repair:needed",
    "repair:exhausted",
    "state:terminal",
    "autonomy:paused",
  ],
  selfModificationPaths: [".github", "scripts/integration"],
  selfModificationApprovalLabel: "self-modification:safe",
  selfModificationVerdictRequired: true,
  deploymentPaths: ["infra", ".github/workflows/production.yml"],
  deploymentCompatibilityLabel: "deployment:compatible",
  deploymentIncompatibilityLabel: "deployment:incompatible",
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function passingSelfModificationVerdict(headSha: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    schemaVersion: 1,
    candidateSha: headSha,
    isolatedWorkspace: { liveSettingsMutated: false },
    evidenceCoverage: { passed: true },
    scenarios: [{ passed: true }, { passed: true }],
    toolChecks: [
      { required: true, passed: true },
      { required: false, passed: true },
    ],
    canary: { activated: true, reverted: false, terminalIncident: false },
    decision: { allowed: true },
  };
  const payload = Buffer.from(stableJson(unsigned));
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      payloadDigest: createHash("sha256").update(payload).digest("hex"),
      value: sign(null, payload, privateKey).toString("base64"),
    },
  };
}

const integrationCandidate: IntegrationCandidate = {
  headSha: "abc123",
  author: "implementer",
  labels: [],
  goalLabels: ["state:reviewed"],
  changedFiles: ["apps/api/src/app.ts"],
  checks: [
    { name: "verify", status: "completed", conclusion: "success" },
    { name: "codeql", status: "completed", conclusion: "success" },
  ],
  reviews: [
    {
      author: "independent-reviewer",
      state: "APPROVED",
      commitId: "abc123",
    },
  ],
  evidence: {
    schemaVersion: 1,
    commit: "abc123",
    checks: [
      { id: "format", status: "passed" },
      { id: "unit", status: "passed" },
    ],
  },
};

describe("evaluateIntegrationGate", () => {
  it("allows a fully evidenced, independently reviewed candidate", () => {
    expect(
      evaluateIntegrationGate(integrationPolicy, integrationCandidate),
    ).toEqual({
      allowed: true,
      headSha: "abc123",
      reasons: [],
      independentReviewer: "independent-reviewer",
      selfModification: false,
      deploymentChange: false,
    });
  });

  it("rejects stale, failed, blocked, and non-independent evidence", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      goalLabels: ["state:terminal", "repair:needed"],
      checks: [{ name: "verify", status: "completed", conclusion: "failure" }],
      reviews: [
        { author: "implementer", state: "APPROVED", commitId: "abc123" },
      ],
      evidence: {
        schemaVersion: 2,
        commit: "old",
        checks: [{ id: "format", status: "failed" }],
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "unsupported evidence manifest schema",
        "evidence manifest is stale for the pull request head",
        "required evidence check format is failed",
        "required evidence check unit is missing",
        "required GitHub check verify has not passed",
        "required GitHub check codeql has not passed",
        "goal is not in state:reviewed",
        "blocking label is present: repair:needed",
        "blocking label is present: state:terminal",
        "independent approval for the current head is missing",
      ]),
    );
  });

  it("requires explicit safety and compatibility evaluation for sensitive changes", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      changedFiles: [
        ".github/workflows/ci.yml",
        ".github/workflows/production.yml",
      ],
      labels: ["deployment:incompatible"],
    });

    expect(decision.selfModification).toBe(true);
    expect(decision.deploymentChange).toBe(true);
    expect(decision.reasons).toContain(
      "signed self-modification verdict is missing or invalid",
    );
    expect(decision.reasons).toContain("deployment is marked incompatible");
  });

  it("accepts explicit sensitive-change evaluations", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      changedFiles: ["scripts/integration/evaluate.mjs", "infra/main.bicep"],
      labels: ["self-modification:safe", "deployment:compatible"],
      selfModificationVerdict: passingSelfModificationVerdict("abc123"),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.selfModification).toBe(true);
    expect(decision.deploymentChange).toBe(true);
  });

  it("uses the latest check and review evidence", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      checks: [
        {
          id: 1,
          name: "verify",
          status: "completed",
          conclusion: "failure",
          completedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          name: "verify",
          status: "completed",
          conclusion: "success",
          completedAt: "2026-01-01T00:01:00Z",
        },
        { name: "codeql", status: "completed", conclusion: "success" },
      ],
      reviews: [
        {
          author: "independent-reviewer",
          state: "CHANGES_REQUESTED",
          commitId: "abc123",
          submittedAt: "2026-01-01T00:00:00Z",
        },
        {
          author: "Independent-Reviewer",
          state: "APPROVED",
          commitId: "abc123",
          submittedAt: "2026-01-01T00:01:00Z",
        },
      ],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.independentReviewer).toBe("Independent-Reviewer");
  });

  it("orders equal check ids by completion time", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      checks: [
        {
          id: 7,
          name: "verify",
          status: "completed",
          conclusion: "failure",
          completedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: 7,
          name: "verify",
          status: "completed",
          conclusion: "success",
          completedAt: "2026-01-01T00:01:00Z",
        },
        {
          id: 6,
          name: "verify",
          status: "completed",
          conclusion: "failure",
          completedAt: "2026-01-01T00:02:00Z",
        },
        { name: "codeql", status: "completed", conclusion: "success" },
      ],
      reviews: [
        {
          author: "independent-reviewer",
          state: "APPROVED",
          commitId: "abc123",
          submittedAt: "2026-01-02T00:00:00Z",
        },
        {
          author: "INDEPENDENT-REVIEWER",
          state: "CHANGES_REQUESTED",
          commitId: "abc123",
          submittedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(decision.allowed).toBe(true);
  });

  it("uses the latest check run and latest review per actor", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      checks: [
        {
          id: 1,
          name: "verify",
          status: "completed",
          conclusion: "success",
        },
        { id: 2, name: "verify", status: "queued", conclusion: null },
        {
          id: 1,
          name: "codeql",
          status: "completed",
          conclusion: "success",
        },
      ],
      reviews: [
        {
          author: "independent-reviewer",
          state: "APPROVED",
          commitId: "abc123",
          submittedAt: "2026-01-01T00:00:00Z",
        },
        {
          author: "independent-reviewer",
          state: "CHANGES_REQUESTED",
          commitId: "abc123",
          submittedAt: "2026-01-02T00:00:00Z",
        },
      ],
    });

    expect(decision.reasons).toContain(
      "required GitHub check verify has not passed",
    );
    expect(decision.reasons).toContain(
      "independent approval for the current head is missing",
    );
  });

  it("denies pending reruns and unevaluated deployment changes", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      goalLabels: ["state:reviewed", "autonomy:paused", "repair:exhausted"],
      changedFiles: ["infra/main.bicep"],
      checks: [
        {
          name: "verify",
          status: "completed",
          conclusion: "success",
          completedAt: "2026-01-01T00:00:00Z",
        },
        {
          name: "verify",
          status: "in_progress",
          conclusion: null,
          completedAt: "2026-01-02T00:00:00Z",
        },
        {
          name: "codeql",
          status: "completed",
          conclusion: "success",
        },
      ],
    });

    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "required GitHub check verify has not passed",
        "blocking label is present: repair:exhausted",
        "blocking label is present: autonomy:paused",
        "deployment compatibility evaluation is missing",
      ]),
    );
  });
  it("blocks deployment changes without compatibility evidence", () => {
    const decision = evaluateIntegrationGate(integrationPolicy, {
      ...integrationCandidate,
      changedFiles: ["infra/main.bicep"],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "deployment compatibility evaluation is missing",
    );
  });
});
