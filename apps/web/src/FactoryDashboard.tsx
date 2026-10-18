import type {
  FactoryMetrics,
  FactoryOverviewResponse,
} from "@dark-factory/contracts";

const metricLabels: ReadonlyArray<{
  key: keyof FactoryMetrics;
  label: string;
  suffix?: string;
  currency?: boolean;
}> = [
  { key: "throughputPerWeek", label: "Throughput", suffix: " / week" },
  { key: "goalLeadTimeHours", label: "Goal lead time", suffix: " h" },
  {
    key: "autonomousCompletionRate",
    label: "Autonomous completion",
    suffix: "%",
  },
  { key: "retryCount", label: "Retries" },
  { key: "repairCount", label: "Repairs" },
  { key: "rollbackRate", label: "Rollback rate", suffix: "%" },
  { key: "escapedDefects", label: "Escaped defects" },
  { key: "mttrMinutes", label: "MTTR", suffix: " min" },
  { key: "estimatedAgentCostUsd", label: "Agent cost", currency: true },
  { key: "estimatedRuntimeCostUsd", label: "Runtime cost", currency: true },
];

export function FactoryDashboard({
  overview,
}: Readonly<{ overview: FactoryOverviewResponse | null }>) {
  if (!overview) return null;

  return (
    <>
      {overview.source === "demo" && (
        <section className="notice" aria-label="Demo limitations">
          <strong>Synthetic demo data — not customer results</strong>
          <span>
            Metrics and costs are illustrative. Offline scenarios do not update
            this dashboard or deploy resources. Live telemetry requires a
            production operations adapter.
          </span>
        </section>
      )}
      <section className="section-heading dashboard-heading">
        <div>
          <p className="eyebrow">Factory outcomes</p>
          <h2>Autonomous delivery</h2>
        </div>
        <span>
          {overview.source} data · {overview.generatedAt}
        </span>
      </section>
      <section className="grid metric-grid" aria-label="Factory metrics">
        {metricLabels.map(({ key, label, suffix = "", currency }) => (
          <article key={key}>
            <span className="label">{label}</span>
            <strong className="value">
              {currency ? "$" : ""}
              {overview.metrics[key]}
              {suffix}
            </strong>
          </article>
        ))}
      </section>

      <section className="operations-grid" aria-label="Factory operations">
        <article>
          <span className="label">Active goals</span>
          {overview.activeGoals.map((goal) => (
            <div className="list-row" key={goal.id}>
              <strong>{goal.title}</strong>
              <small>
                {goal.id} · {goal.state} · {goal.owner}
              </small>
            </div>
          ))}
        </article>
        <article>
          <span className="label">Active incidents</span>
          {overview.activeIncidents.length === 0 ? (
            <small>No active incidents</small>
          ) : (
            overview.activeIncidents.map((incident) => (
              <div className="list-row" key={incident.id}>
                <strong>{incident.title}</strong>
                <small>
                  {incident.severity} · {incident.status}
                </small>
              </div>
            ))
          )}
        </article>
        <article>
          <span className="label">Deployments</span>
          {overview.deployments.map((deployment) => (
            <div className="list-row" key={deployment.id}>
              <strong>{deployment.status}</strong>
              <small>
                {deployment.environment} · {deployment.revision}
              </small>
            </div>
          ))}
        </article>
      </section>

      <section className="audit-panel" aria-labelledby="audit-heading">
        <div>
          <p className="eyebrow">Decision ledger</p>
          <h2 id="audit-heading">Audit events</h2>
        </div>
        <div className="audit-list">
          {overview.auditEvents.map((event) => (
            <article key={event.id}>
              <div className="audit-title">
                <strong>{event.action}</strong>
                <span className={`badge ${event.outcome}`}>
                  {event.outcome}
                </span>
              </div>
              <p>{event.detail}</p>
              <small>
                {event.actor} · {event.correlation.goalId} · PR{" "}
                {event.correlation.pullRequest} ·{" "}
                {event.correlation.commitSha.slice(0, 7)}
              </small>
              <details>
                <summary>Correlation</summary>
                <code>
                  run={event.correlation.workflowRunId} deployment=
                  {event.correlation.deploymentId} revision=
                  {event.correlation.revision} trace={event.correlation.traceId}{" "}
                  correlation={event.correlation.correlationId} verdict=
                  {event.correlation.policyVerdict}
                </code>
              </details>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
