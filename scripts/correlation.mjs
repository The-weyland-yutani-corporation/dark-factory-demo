import { createHash } from "node:crypto";

export function createDecisionCorrelation(input = {}) {
  const base = {
    goalId: String(input.goalId ?? "unknown-goal"),
    pullRequest: String(input.pullRequest ?? "no-pull-request"),
    commitSha: String(input.commitSha ?? "unknown-commit"),
    workflowRunId: String(input.workflowRunId ?? "local"),
    deploymentId: String(input.deploymentId ?? "not-created"),
    revision: String(input.revision ?? "not-deployed"),
    policyVerdict: String(input.policyVerdict ?? "pending"),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(base))
    .digest("hex");
  return {
    ...base,
    traceId: String(input.traceId ?? digest.slice(0, 32)),
    correlationId: String(
      input.correlationId ?? `decision-${digest.slice(0, 24)}`,
    ),
  };
}

export function missingCorrelationFields(correlation) {
  return [
    "goalId",
    "pullRequest",
    "commitSha",
    "workflowRunId",
    "deploymentId",
    "revision",
    "traceId",
    "correlationId",
    "policyVerdict",
  ].filter((field) => !String(correlation?.[field] ?? "").trim());
}
