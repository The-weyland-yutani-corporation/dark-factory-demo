import assert from "node:assert/strict";
import test from "node:test";
import {
  createDecisionCorrelation,
  missingCorrelationFields,
} from "../correlation.mjs";
import {
  canonicalizeEvent,
  classifySeverity,
  fingerprintSignal,
  incidentBody,
  repairGoalBody,
} from "./incident-core.mjs";

test("decision correlation is complete and deterministic", () => {
  const input = {
    goalId: "goal-1",
    pullRequest: "42",
    commitSha: "a".repeat(40),
    workflowRunId: "run-7",
    policyVerdict: "allow:test",
  };
  const first = createDecisionCorrelation(input);
  const second = createDecisionCorrelation(input);
  assert.deepEqual(first, second);
  assert.deepEqual(missingCorrelationFields(first), []);
  assert.equal(first.deploymentId, "not-created");
  assert.equal(first.revision, "not-deployed");
});

test("decision correlation reports empty required fields", () => {
  assert.deepEqual(missingCorrelationFields({ goalId: "" }), [
    "goalId",
    "pullRequest",
    "commitSha",
    "workflowRunId",
    "deploymentId",
    "revision",
    "traceId",
    "correlationId",
    "policyVerdict",
  ]);
});

test("Azure common alert schema becomes a severe incident", () => {
  const signal = canonicalizeEvent("repository_dispatch", {
    client_payload: {
      data: {
        essentials: {
          alertRule: "API availability",
          severity: "Sev1",
          monitorCondition: "Fired",
          signalType: "Metric",
          alertTargetIDs: [
            "/subscriptions/x/resourceGroups/rg/providers/Microsoft.App/containerApps/api",
          ],
        },
        alertContext: { commitSha: "abc123", revision: "api--abc123" },
      },
    },
  });
  assert.equal(signal.severity, "sev2-high");
  assert.equal(signal.severe, true);
  assert.equal(signal.commit, "abc123");
  assert.match(signal.incidentKey, /^production:metric:/);
});

test("fingerprints suppress timestamps but separate deployments", () => {
  const base = {
    environment: "production",
    service: "api",
    classification: "synthetic-regression",
    rule: "health",
    resource: "https://example.test",
    commit: "one",
  };
  assert.equal(
    fingerprintSignal(base),
    fingerprintSignal({ ...base, observedAt: "later" }),
  );
  assert.notEqual(
    fingerprintSignal(base),
    fingerprintSignal({ ...base, commit: "two" }),
  );
});

test("workflow failures create bounded repair contracts", () => {
  const signal = canonicalizeEvent("workflow_run", {
    workflow_run: {
      name: "Deterministic verification",
      conclusion: "failure",
      head_sha: "deadbeef",
      html_url: "https://example.test/run",
      head_repository: { full_name: "owner/repo" },
    },
  });
  assert.equal(signal.severe, false);
  assert.match(incidentBody(signal, "https://example.test/run"), /fingerprint/);
  assert.match(
    repairGoalBody(signal, "https://example.test/incidents/1").body,
    /stricter-half-budget/,
  );
});

test("severity normalization is conservative", () => {
  assert.equal(classifySeverity(0), "sev1-critical");
  assert.equal(classifySeverity("Sev1"), "sev2-high");
  assert.equal(classifySeverity("Sev2"), "sev3-moderate");
  assert.equal(classifySeverity("unknown"), "sev3-moderate");
});
