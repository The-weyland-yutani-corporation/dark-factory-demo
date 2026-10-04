import { readFile } from "node:fs/promises";
import {
  canonicalizeEvent,
  incidentBody,
  repairGoalBody,
} from "./incident-core.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${required("GITHUB_TOKEN")}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function syntheticProbe() {
  const baseUrl = required("PRODUCTION_BASE_URL").replace(/\/$/, "");
  const observedAt = new Date().toISOString();
  try {
    const [healthResponse, versionResponse] = await Promise.all([
      fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(10_000) }),
      fetch(`${baseUrl}/version`, { signal: AbortSignal.timeout(10_000) }),
    ]);
    const health = await healthResponse.json();
    const version = await versionResponse.json();
    if (!healthResponse.ok || health.status !== "ok" || !versionResponse.ok) {
      throw new Error(
        `health=${healthResponse.status}; version=${versionResponse.status}`,
      );
    }
    return {
      ok: true,
      url: baseUrl,
      commit: version.commit,
      summary: "Production synthetic probe recovered.",
      observedAt,
    };
  } catch (error) {
    return {
      ok: false,
      url: baseUrl,
      severity: "high",
      summary: `Production synthetic probe failed: ${error instanceof Error ? error.message : String(error)}`,
      observedAt,
    };
  }
}

async function findIssue(repository, marker, label) {
  const query = encodeURIComponent(
    `repo:${repository} is:issue label:"${label}" in:body "${marker}"`,
  );
  const result = await github(`/search/issues?q=${query}&per_page=10`);
  return result.items?.[0] ?? null;
}

async function createIssue(repository, title, body, labels) {
  return github(`/repos/${repository}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels }),
  });
}

async function comment(repository, number, body) {
  await github(`/repos/${repository}/issues/${number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function patchIssue(repository, number, patch) {
  return github(`/repos/${repository}/issues/${number}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function replaceState(repository, issue, nextState) {
  const labels = issue.labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((label) => label && !label.startsWith("state:"));
  labels.push(nextState);
  await patchIssue(repository, issue.number, { labels });
}

async function dispatchRollback(repository, signal) {
  await github(
    `/repos/${repository}/actions/workflows/rollback.yml/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: process.env.DEFAULT_BRANCH ?? "main",
        inputs: {
          target_revision: process.env.ROLLBACK_TARGET_REVISION ?? "",
          incident_fingerprint: signal.fingerprint,
        },
      }),
    },
  );
}

const repository = required("GITHUB_REPOSITORY");
const eventName =
  process.env.INCIDENT_EVENT_NAME ??
  process.env.GITHUB_EVENT_NAME ??
  "repository_dispatch";
const eventPath =
  process.env.INCIDENT_EVENT_PATH ?? process.env.GITHUB_EVENT_PATH;
const event = eventPath ? JSON.parse(await readFile(eventPath, "utf8")) : {};
if (
  eventName === "workflow_run" &&
  (event.workflow_run?.conclusion === "success" ||
    event.workflow_run?.head_branch !== (process.env.DEFAULT_BRANCH ?? "main"))
) {
  console.log("Workflow run is not an actionable production failure.");
  process.exit(0);
}

const signal = canonicalizeEvent(
  eventName,
  event,
  eventName === "schedule" ? await syntheticProbe() : null,
);
const marker = `incident-fingerprint:${signal.fingerprint}`;
let incident = await findIssue(repository, marker, "type:incident");

if (signal.status === "resolved") {
  if (incident) {
    await comment(
      repository,
      incident.number,
      `Recovery signal received from ${signal.source} at ${signal.observedAt}.`,
    );
    await replaceState(repository, incident, "state:resolved");
  }
  console.log(`Resolved signal ${signal.incidentKey} reconciled.`);
  process.exit(0);
}

if (!incident) {
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  incident = await createIssue(
    repository,
    `[Incident] ${signal.severity}: ${signal.classification} (${signal.fingerprint})`,
    incidentBody(signal, runUrl),
    ["type:incident", "state:reported"],
  );
} else {
  await comment(
    repository,
    incident.number,
    `Duplicate signal suppressed. Source: ${signal.source}; observed: ${signal.observedAt}; SHA: ${signal.commit ?? "unknown"}.`,
  );
}

if (signal.severe) {
  const rollbackMarker = `rollback-admitted:${signal.fingerprint}`;
  if (!incident.body?.includes(rollbackMarker)) {
    incident = await patchIssue(repository, incident.number, {
      body: `${incident.body}\n\n<!-- ${rollbackMarker} -->`,
    });
    await dispatchRollback(repository, signal);
  }
  await replaceState(repository, incident, "state:investigating");
  console.log(`Rollback route admitted for ${signal.incidentKey}.`);
} else {
  const repair = repairGoalBody(signal, incident.html_url);
  const existingGoal = await findIssue(
    repository,
    `incident-fingerprint:${signal.fingerprint};fix-forward`,
    "type:goal",
  );
  if (!existingGoal)
    await createIssue(
      repository,
      `[Goal] Bounded fix-forward for ${signal.fingerprint}`,
      repair.body,
      ["type:goal", "state:submitted", "risk:medium"],
    );
  console.log(`Bounded fix-forward route admitted for ${signal.incidentKey}.`);
}
