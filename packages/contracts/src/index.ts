export const policyActions = ["allow", "deny"] as const;

export type PolicyAction = (typeof policyActions)[number];

export interface PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly action: PolicyAction;
  readonly priority: number;
  readonly conditions: Readonly<Record<string, string>>;
}

export interface PolicyContext {
  readonly subject: string;
  readonly resource: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly matchedRuleId: string | null;
  readonly reason: string;
}

export interface HealthResponse {
  readonly status: "ok";
  readonly service: string;
  readonly timestamp: string;
}

export interface ReadinessResponse {
  readonly status: "ready" | "not-ready";
  readonly checks: Readonly<Record<string, boolean>>;
}

export interface VersionResponse {
  readonly service: string;
  readonly version: string;
  readonly node: string;
  readonly commit: string | null;
}

export interface PolicyEvaluationRequest {
  readonly context: PolicyContext;
  readonly rules: readonly PolicyRule[];
  readonly defaultAction: PolicyAction;
  readonly correlation: DecisionCorrelation;
}

export interface PolicyEvaluationResponse {
  readonly decision: PolicyDecision;
  readonly evaluatedRules: number;
  readonly correlation: DecisionCorrelation;
}

export interface ApiErrorResponse {
  readonly error: string;
  readonly message: string;
  readonly statusCode: number;
}

export interface DecisionCorrelation {
  readonly goalId: string;
  readonly pullRequest: string;
  readonly commitSha: string;
  readonly workflowRunId: string;
  readonly deploymentId: string;
  readonly revision: string;
  readonly traceId: string;
  readonly correlationId: string;
  readonly policyVerdict: string;
}

export interface FactoryMetrics {
  readonly throughputPerWeek: number;
  readonly goalLeadTimeHours: number;
  readonly autonomousCompletionRate: number;
  readonly retryCount: number;
  readonly repairCount: number;
  readonly rollbackRate: number;
  readonly escapedDefects: number;
  readonly mttrMinutes: number;
  readonly estimatedAgentCostUsd: number;
  readonly estimatedRuntimeCostUsd: number;
}

export interface ActiveGoal {
  readonly id: string;
  readonly title: string;
  readonly state: "planning" | "executing" | "repairing" | "reviewing";
  readonly owner: string;
  readonly updatedAt: string;
  readonly correlation: DecisionCorrelation;
}

export interface ActiveIncident {
  readonly id: string;
  readonly severity: "sev0" | "sev1" | "sev2" | "sev3";
  readonly title: string;
  readonly status: "investigating" | "mitigating" | "monitoring";
  readonly startedAt: string;
  readonly correlation: DecisionCorrelation;
}

export interface DeploymentSummary {
  readonly id: string;
  readonly environment: string;
  readonly status: "healthy" | "progressing" | "rolled-back" | "failed";
  readonly revision: string;
  readonly deployedAt: string;
  readonly correlation: DecisionCorrelation;
}

export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly action: string;
  readonly outcome: "allowed" | "denied" | "succeeded" | "failed";
  readonly detail: string;
  readonly correlation: DecisionCorrelation;
}

export interface FactoryOverviewResponse {
  readonly generatedAt: string;
  readonly source: "demo" | "production";
  readonly metrics: FactoryMetrics;
  readonly activeGoals: readonly ActiveGoal[];
  readonly activeIncidents: readonly ActiveIncident[];
  readonly deployments: readonly DeploymentSummary[];
  readonly auditEvents: readonly AuditEvent[];
}
