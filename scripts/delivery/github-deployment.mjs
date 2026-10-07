import { appendFile } from "node:fs/promises";
import { createDecisionCorrelation } from "../correlation.mjs";
import { required } from "./lib.mjs";

const [command] = process.argv.slice(2);
const token = required("GITHUB_TOKEN");
const repository = required("GITHUB_REPOSITORY");
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

async function github(path, options = {}) {
  const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

// Commands are implemented below to keep GitHub deployment writes auditable.
if (command === "create") {
  const deployment = await github("/deployments", {
    method: "POST",
    body: JSON.stringify({
      ref: required("DEPLOYMENT_REF"),
      environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "production",
      description: process.env.DEPLOYMENT_DESCRIPTION ?? "Autonomous delivery",
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: true,
      payload: createDecisionCorrelation({
        goalId: process.env.GOAL_ID,
        pullRequest: process.env.PR_NUMBER,
        commitSha: required("DEPLOYMENT_REF"),
        workflowRunId: process.env.GITHUB_RUN_ID,
        deploymentId: "pending-github-response",
        revision: process.env.REVISION,
        policyVerdict: process.env.POLICY_VERDICT ?? "allow:delivery",
      }),
    }),
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `deployment_id=${deployment.id}\n`,
    );
  }
  console.log(`Created GitHub deployment ${deployment.id}`);
} else if (command === "status") {
  const deploymentId = required("DEPLOYMENT_ID");
  const state = required("DEPLOYMENT_STATE");
  await github(`/deployments/${deploymentId}/statuses`, {
    method: "POST",
    body: JSON.stringify({
      state,
      description: process.env.DEPLOYMENT_DESCRIPTION ?? "Delivery status",
      environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "production",
      environment_url: process.env.ENVIRONMENT_URL || undefined,
      log_url:
        process.env.GITHUB_SERVER_URL &&
        `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      auto_inactive: state === "success",
    }),
  });
  console.log(`Recorded ${state} for ${deploymentId}`);
} else {
  throw new Error("Usage: github-deployment.mjs <create|status>");
}
