import type {
  FactoryOverviewResponse,
  HealthResponse,
  PolicyEvaluationResponse,
  ReadinessResponse,
  VersionResponse,
} from "@dark-factory/contracts";
import { useCallback, useEffect, useState } from "react";
import { FactoryDashboard } from "./FactoryDashboard.js";

type DashboardState =
  | { status: "loading" }
  | {
      status: "loaded";
      health: HealthResponse;
      readiness: ReadinessResponse;
      version: VersionResponse;
      factory: FactoryOverviewResponse;
    }
  | { status: "error"; message: string };

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(
  path: string,
  init?: Readonly<RequestInit>,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export function App() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [policy, setPolicy] = useState<PolicyEvaluationResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      request<HealthResponse>("/healthz"),
      request<ReadinessResponse>("/readyz"),
      request<VersionResponse>("/version"),
      request<FactoryOverviewResponse>("/api/factory/overview"),
    ])
      .then(([health, readiness, version, factory]) => {
        if (!controller.signal.aborted) {
          setState({ status: "loaded", health, readiness, version, factory });
          setLastUpdated(new Date().toLocaleTimeString());
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return controller;
  }, []);

  useEffect(() => {
    const controller = refresh();
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    void request<PolicyEvaluationResponse>("/api/policies/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultAction: "deny",
        context: {
          subject: "deployment-agent",
          resource: "production",
          attributes: { risk: "low", region: "eastus" },
        },
        rules: [
          {
            id: "allow-low-risk",
            description: "Low-risk automated deployments are approved",
            action: "allow",
            priority: 10,
            conditions: { risk: "low" },
          },
        ],
        correlation: {
          goalId: "goal-dashboard-preview",
          pullRequest: "#0",
          commitSha: "0000000000000000000000000000000000000000",
          workflowRunId: "local-dashboard",
          deploymentId: "not-deployed",
          revision: "local",
          traceId: "00000000000000000000000000000000",
          correlationId: "dashboard-policy-preview",
          policyVerdict: "pending",
        },
      }),
    }).then(setPolicy);
  }, []);

  return (
    <main>
      <header className="masthead">
        <div>
          <p className="eyebrow">Autonomous operations</p>
          <h1>Control Room</h1>
          <p className="subtitle">
            Live service posture and deterministic deployment policy
          </p>
        </div>
        <button type="button" onClick={refresh}>
          Refresh status
        </button>
      </header>

      <section className="section-heading">
        <div>
          <p className="eyebrow">System posture</p>
          <h2>Runtime status</h2>
        </div>
        <span>{lastUpdated ? `Updated ${lastUpdated}` : "Connecting…"}</span>
      </section>

      {state.status === "loading" && (
        <section className="notice">Reading control plane telemetry…</section>
      )}
      {state.status === "error" && (
        <section className="notice error">
          <strong>API unavailable</strong>
          <span>{state.message}</span>
        </section>
      )}
      {state.status === "loaded" && (
        <section className="grid status-grid" aria-label="Service status">
          <article>
            <span className="signal good" aria-hidden="true" />
            <span className="label">Health</span>
            <strong className="value good">{state.health.status}</strong>
            <small>{state.health.service}</small>
          </article>
          <article>
            <span
              className={`signal ${
                state.readiness.status === "ready" ? "good" : "bad"
              }`}
              aria-hidden="true"
            />
            <span className="label">Readiness</span>
            <strong
              className={`value ${
                state.readiness.status === "ready" ? "good" : "bad"
              }`}
            >
              {state.readiness.status}
            </strong>
            <small>API check</small>
          </article>
          <article>
            <span className="signal neutral" aria-hidden="true" />
            <span className="label">Version</span>
            <strong className="value">{state.version.version}</strong>
            <small>
              {state.version.node}
              {state.version.commit
                ? ` · ${state.version.commit.slice(0, 7)}`
                : ""}
            </small>
          </article>
        </section>
      )}

      <FactoryDashboard
        overview={state.status === "loaded" ? state.factory : null}
      />

      <section className="policy-panel">
        <div>
          <p className="eyebrow">Decision preview</p>
          <h2>Production deployment</h2>
          <p className="subtitle">
            Subject <code>deployment-agent</code> · risk <code>low</code>
          </p>
        </div>
        <div className="decision">
          <span className="label">Policy result</span>
          <strong
            className={policy?.decision.action === "allow" ? "good" : "bad"}
          >
            {policy?.decision.action ?? "evaluating"}
          </strong>
          <small>
            {policy?.decision.reason ?? "Contacting policy engine…"}
          </small>
        </div>
      </section>

      <footer>
        <span>Dark Factory</span>
        <span>Policy decisions are deterministic and deny by default.</span>
      </footer>
    </main>
  );
}
