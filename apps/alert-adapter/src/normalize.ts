import { createHash } from "node:crypto";
import type { CommonAlertSchema, NormalizedAlert } from "./types.js";

const severityMap: Record<
  string,
  { normalized: NormalizedAlert["severity"]["normalized"]; priority: number }
> = {
  Sev0: { normalized: "critical", priority: 0 },
  Sev1: { normalized: "high", priority: 1 },
  Sev2: { normalized: "medium", priority: 2 },
  Sev3: { normalized: "low", priority: 3 },
  Sev4: { normalized: "informational", priority: 4 },
};

const commitKeys = new Set([
  "commit",
  "commitsha",
  "commit_sha",
  "gitcommit",
  "gitcommitsha",
  "git_commit_sha",
]);
const revisionKeys = new Set([
  "revision",
  "revisionname",
  "containerapprevision",
  "containerappsrevision",
  "container_app_revision",
]);
const ruleIdKeys = new Set([
  "alertruleid",
  "alert_rule_id",
  "ruleid",
  "rule_id",
]);
const correlationKeys = new Set([
  "correlationid",
  "correlation_id",
  "operationid",
  "operation_id",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenScalars(
  value: unknown,
  result: Array<[string, string]> = [],
): Array<[string, string]> {
  if (Array.isArray(value)) {
    for (const item of value) flattenScalars(item, result);
  } else if (isRecord(value)) {
    if (
      typeof value.name === "string" &&
      (typeof value.value === "string" ||
        typeof value.value === "number" ||
        typeof value.value === "boolean")
    ) {
      result.push([value.name.toLowerCase(), String(value.value)]);
    }
    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        result.push([key.toLowerCase(), String(item)]);
      } else {
        flattenScalars(item, result);
      }
    }
  }
  return result;
}

function firstValue(
  entries: Array<[string, string]>,
  keys: Set<string>,
): string | undefined {
  return entries.find(([key, value]) => keys.has(key) && value.length > 0)?.[1];
}

function extractRevisionFromResourceId(
  resourceIds: string[],
): string | undefined {
  for (const resourceId of resourceIds) {
    const match = /\/revisions\/([^/]+)(?:\/|$)/i.exec(resourceId);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function normalizeAlert(payload: unknown): NormalizedAlert {
  if (!isRecord(payload)) throw new Error("Payload must be a JSON object.");

  const alert = payload as CommonAlertSchema;
  const essentials = alert.data?.essentials;
  if (!essentials || !essentials.alertId || !essentials.alertRule) {
    throw new Error(
      "Azure Monitor common alert schema essentials.alertId and essentials.alertRule are required.",
    );
  }

  const targetResourceIds = (essentials.alertTargetIDs ?? []).filter(Boolean);
  const scalarEntries = flattenScalars({
    alertContext: alert.data?.alertContext,
    customProperties: alert.data?.customProperties,
  });
  const azureSeverity = essentials.severity ?? "Sev4";
  const mappedSeverity = severityMap[azureSeverity] ?? {
    normalized: "informational",
    priority: 4,
  };
  const ruleId = firstValue(scalarEntries, ruleIdKeys);
  const commitSha = firstValue(scalarEntries, commitKeys);
  const containerAppsRevision =
    firstValue(scalarEntries, revisionKeys) ??
    extractRevisionFromResourceId(targetResourceIds);
  const isContainerApps =
    containerAppsRevision !== undefined ||
    targetResourceIds.some((id) =>
      id.toLowerCase().includes("/providers/microsoft.app/containerapps/"),
    );

  return {
    schemaVersion: "1.0",
    source: "azure-monitor",
    eventType: isContainerApps ? "container-apps-alert" : "azure-monitor-alert",
    alertId: essentials.alertId,
    rule: {
      name: essentials.alertRule,
      ...(ruleId ? { id: ruleId } : {}),
    },
    correlationId:
      essentials.correlationId ??
      firstValue(scalarEntries, correlationKeys) ??
      essentials.originAlertId ??
      essentials.alertId,
    status: essentials.monitorCondition ?? "Fired",
    severity: {
      azure: azureSeverity,
      normalized: mappedSeverity.normalized,
      priority: mappedSeverity.priority,
    },
    ...(essentials.signalType ? { signalType: essentials.signalType } : {}),
    ...(essentials.monitoringService
      ? { monitoringService: essentials.monitoringService }
      : {}),
    ...(essentials.firedDateTime ? { firedAt: essentials.firedDateTime } : {}),
    ...(essentials.resolvedDateTime
      ? { resolvedAt: essentials.resolvedDateTime }
      : {}),
    ...(essentials.description ? { description: essentials.description } : {}),
    targetResourceIds,
    configurationItems: essentials.configurationItems ?? [],
    ...(commitSha ? { commitSha: commitSha } : {}),
    ...(containerAppsRevision ? { containerAppsRevision } : {}),
  };
}

export function alertDeduplicationKey(alert: NormalizedAlert): string {
  return createHash("sha256")
    .update(`${alert.alertId}\n${alert.status}\n${alert.correlationId}`)
    .digest("hex");
}
