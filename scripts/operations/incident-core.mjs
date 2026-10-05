import { createHash } from "node:crypto";

const severityNames = {
  0: "sev1-critical",
  1: "sev2-high",
  2: "sev3-moderate",
  3: "sev4-low",
  4: "sev4-low",
};

export function normalizeToken(value, fallback = "unknown") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function classifySeverity(value) {
  if (typeof value === "number" || /^\d+$/.test(String(value ?? ""))) {
    return severityNames[Number(value)] ?? "sev3-moderate";
  }
  const normalized = normalizeToken(value);
  const azureSeverity = /^sev([0-4])$/.exec(normalized);
  if (azureSeverity) {
    return severityNames[Number(azureSeverity[1])] ?? "sev3-moderate";
  }
  if (["critical", "fatal"].includes(normalized)) {
    return "sev1-critical";
  }
  if (["high", "error"].includes(normalized)) return "sev2-high";
  if (["low", "info"].includes(normalized)) return "sev4-low";
  return "sev3-moderate";
}

export function fingerprintSignal(signal) {
  const stableIdentity = [
    normalizeToken(signal.environment, "production"),
    normalizeToken(signal.service),
    normalizeToken(signal.classification),
    normalizeToken(signal.rule),
    normalizeToken(signal.resource),
    normalizeToken(signal.commit ?? signal.revision, "unversioned"),
  ].join(":");
  return createHash("sha256").update(stableIdentity).digest("hex").slice(0, 24);
}

function alertSignal(payload) {
  const data = payload.data ?? payload;
  const essentials = data.essentials ?? data;
  const context = data.alertContext ?? {};
  const target =
    essentials.alertTargetIDs?.[0] ??
    essentials.alertTargetIds?.[0] ??
    payload.targetResourceIds?.[0] ??
    context.resourceId ??
    payload.resourceId;
  const state = normalizeToken(
    essentials.monitorCondition ?? essentials.condition ?? payload.status,
    "fired",
  );
  const alertSeverity = essentials.severity ?? payload.severity;
  const normalizedSeverity =
    typeof alertSeverity === "object" && alertSeverity !== null
      ? (alertSeverity.normalized ?? alertSeverity.azure)
      : alertSeverity;
  return {
    source: "azure-monitor",
    service:
      payload.service ??
      context.serviceName ??
      target?.split("/").at(-1) ??
      "production",
    environment: payload.environment ?? "production",
    classification: normalizeToken(
      payload.classification ??
        essentials.signalType ??
        payload.signalType ??
        context.conditionType ??
        "monitor-alert",
    ),
    rule:
      essentials.alertRule ??
      essentials.alertRuleName ??
      payload.rule?.name ??
      payload.alertRule ??
      "azure-monitor",
    resource: target ?? "azure-resource",
    severity: classifySeverity(normalizedSeverity),
    status: ["resolved", "deactivated"].includes(state) ? "resolved" : "active",
    commit: payload.commitSha ?? context.commitSha,
    revision:
      payload.containerAppsRevision ?? payload.revision ?? context.revision,
    summary:
      essentials.description ??
      payload.description ??
      context.description ??
      payload.summary ??
      "Azure Monitor detected a production regression.",
    evidenceUrl: essentials.alertRuleUrl ?? payload.evidenceUrl,
    observedAt:
      essentials.firedDateTime ??
      essentials.resolvedDateTime ??
      payload.firedAt ??
      payload.resolvedAt ??
      payload.observedAt ??
      new Date().toISOString(),
  };
}

function workflowSignal(workflowRun) {
  const workflowName = workflowRun.name ?? "workflow";
  const classification = workflowName.toLowerCase().includes("rollback")
    ? "rollback-failure"
    : workflowName.toLowerCase().includes("deploy") ||
        workflowName.toLowerCase().includes("production")
      ? "deployment-failure"
      : "workflow-failure";
  return {
    source: "github-actions",
    service: "dark-factory",
    environment: "production",
    classification,
    rule: workflowName,
    resource: workflowRun.head_repository?.full_name ?? "repository",
    severity:
      classification === "rollback-failure"
        ? "sev1-critical"
        : classification === "deployment-failure"
          ? "sev2-high"
          : "sev3-moderate",
    status: "active",
    commit: workflowRun.head_sha,
    revision: null,
    summary: `${workflowName} concluded with ${workflowRun.conclusion}.`,
    evidenceUrl: workflowRun.html_url,
    observedAt: workflowRun.updated_at ?? new Date().toISOString(),
  };
}

export function canonicalizeEvent(eventName, event, syntheticResult) {
  let signal;
  if (eventName === "workflow_run") {
    signal = workflowSignal(event.workflow_run ?? {});
  } else if (syntheticResult) {
    signal = {
      source: "synthetic-probe",
      service: syntheticResult.service ?? "dark-factory-api",
      environment: "production",
      classification: "synthetic-regression",
      rule: syntheticResult.probe ?? "production-api",
      resource: syntheticResult.url,
      severity: classifySeverity(syntheticResult.severity ?? "high"),
      status: syntheticResult.ok ? "resolved" : "active",
      commit: syntheticResult.commit,
      revision: syntheticResult.revision,
      summary: syntheticResult.summary,
      evidenceUrl: syntheticResult.evidenceUrl,
      observedAt: syntheticResult.observedAt ?? new Date().toISOString(),
    };
  } else {
    signal = alertSignal(event.client_payload ?? event.inputs ?? event);
  }

  const fingerprint = fingerprintSignal(signal);
  return {
    ...signal,
    fingerprint,
    incidentKey: `production:${normalizeToken(signal.classification)}:${fingerprint}`,
    severe:
      signal.status === "active" &&
      ["sev1-critical", "sev2-high"].includes(signal.severity),
  };
}

export function incidentBody(signal, runUrl) {
  return [
    `<!-- incident-fingerprint:${signal.fingerprint} -->`,
    "## Incident key",
    signal.incidentKey,
    "",
    "## Goal and run correlation",
    `Deployment SHA: ${signal.commit ?? "unknown"}`,
    `Container Apps revision: ${signal.revision ?? "unknown"}`,
    `Automation run: ${runUrl ?? "unavailable"}`,
    "",
    "## Failed lifecycle phase",
    signal.classification.includes("deployment") ? "post-merge" : "validation",
    "",
    "## Classification",
    signal.classification,
    "",
    "## Severity",
    signal.severity,
    "",
    "## Impact",
    signal.summary,
    "",
    "## Evidence",
    `Source: ${signal.source}`,
    `Rule/probe: ${signal.rule}`,
    `Resource: ${signal.resource}`,
    `Observed: ${signal.observedAt}`,
    `Evidence: ${signal.evidenceUrl ?? "access-controlled source"}`,
    "",
    "## Attempts and budget consumption",
    "Admission attempt: 1. Duplicate events update this issue without creating another repair route.",
    "",
    "## Recovery or terminal reason",
    signal.severe
      ? "Rollback is dispatched before diagnosis. Investigation starts only after rollback admission."
      : "A single bounded fix-forward goal may be admitted after deduplication.",
    "",
    "## Safety confirmation",
    "- [x] Mutation is bounded and idempotent.",
    "- [x] Open and closed incidents were searched using the stable fingerprint.",
  ].join("\n");
}

export function repairGoalBody(signal, incidentUrl) {
  const goalKey = `repair-${signal.fingerprint}`;
  return {
    goalKey,
    body: [
      "## Goal key",
      goalKey,
      "",
      "## Desired outcome",
      `Resolve and prevent recurrence of ${signal.classification} recorded in ${incidentUrl}.`,
      "",
      "## Acceptance criteria",
      "- [ ] Add a deterministic regression test that reproduces the sanitized failure.",
      "- [ ] Make the smallest reversible fix and preserve existing production behavior.",
      "- [ ] Pass all required repository verification and delivery checks.",
      "",
      "## Constraints and exclusions",
      "No live production mutation, credential changes, policy weakening, or unrelated refactoring. Delivery remains owned by the existing immutable delivery workflow.",
      "",
      "## Known assumptions and uncertainty",
      `Assumption: sanitized incident evidence at ${incidentUrl} is sufficient for bounded diagnosis. Uncertainty must stop mutation and update the incident.`,
      "",
      "## Required evidence",
      "Regression test, deterministic CI run, independent review, immutable deployment SHA, and post-deployment synthetic verification.",
      "",
      "## Rollback requirements",
      "Revert the repair commit and invoke the existing rollback workflow if post-deployment verification regresses.",
      "",
      "## Risk class",
      "medium",
      "",
      "## Execution budget",
      "stricter-half-budget",
      "",
      "## Authorization and data handling",
      "- [x] Autonomous changes, independent review, bounded repair, and merge are authorized.",
      "- [x] This issue contains no secrets or sensitive customer data.",
      "",
      `<!-- incident-fingerprint:${signal.fingerprint};fix-forward -->`,
    ].join("\n"),
  };
}
