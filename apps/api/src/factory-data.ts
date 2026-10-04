import type {
  AuditEvent,
  DecisionCorrelation,
  FactoryMetrics,
  FactoryOverviewResponse,
} from "@dark-factory/contracts";

export interface GoalOutcome {
  readonly completed: boolean;
  readonly autonomous: boolean;
  readonly leadTimeHours: number;
  readonly retries: number;
  readonly repairs: number;
}

export interface ReliabilityOutcome {
  readonly deployed: boolean;
  readonly rolledBack: boolean;
  readonly escapedDefects: number;
  readonly recoveryMinutes?: number;
  readonly agentCostUsd: number;
  readonly runtimeCostUsd: number;
}

export interface FactoryOperationsAdapter {
  readonly source: "demo" | "production";
  getOverview(): Promise<FactoryOverviewResponse>;
}

export function calculateFactoryMetrics(
  goals: readonly GoalOutcome[],
  reliability: readonly ReliabilityOutcome[],
): FactoryMetrics {
  const completed = goals.filter((goal) => goal.completed);
  const autonomous = completed.filter((goal) => goal.autonomous);
  const deployments = reliability.filter((item) => item.deployed);
  const rollbacks = deployments.filter((item) => item.rolledBack);
  const recoveries = reliability
    .map((item) => item.recoveryMinutes)
    .filter((value): value is number => value !== undefined);
  const rounded = (value: number): number => Math.round(value * 100) / 100;
  const average = (values: readonly number[]): number =>
    values.length === 0
      ? 0
      : rounded(values.reduce((sum, value) => sum + value, 0) / values.length);

  return {
    throughputPerWeek: completed.length,
    goalLeadTimeHours: average(completed.map((goal) => goal.leadTimeHours)),
    autonomousCompletionRate:
      completed.length === 0
        ? 0
        : rounded((autonomous.length / completed.length) * 100),
    retryCount: goals.reduce((sum, goal) => sum + goal.retries, 0),
    repairCount: goals.reduce((sum, goal) => sum + goal.repairs, 0),
    rollbackRate:
      deployments.length === 0
        ? 0
        : rounded((rollbacks.length / deployments.length) * 100),
    escapedDefects: reliability.reduce(
      (sum, item) => sum + item.escapedDefects,
      0,
    ),
    mttrMinutes: average(recoveries),
    estimatedAgentCostUsd: rounded(
      reliability.reduce((sum, item) => sum + item.agentCostUsd, 0),
    ),
    estimatedRuntimeCostUsd: rounded(
      reliability.reduce((sum, item) => sum + item.runtimeCostUsd, 0),
    ),
  };
}

export function validateCorrelation(
  correlation: DecisionCorrelation,
): readonly string[] {
  const fields: ReadonlyArray<keyof DecisionCorrelation> = [
    "goalId",
    "pullRequest",
    "commitSha",
    "workflowRunId",
    "deploymentId",
    "revision",
    "traceId",
    "correlationId",
    "policyVerdict",
  ];
  return fields.filter((field) => correlation[field].trim().length === 0);
}

function correlation(
  goalId: string,
  suffix: string,
  verdict = "allow:bounded-autonomy",
): DecisionCorrelation {
  return {
    goalId,
    pullRequest: `#12${suffix}`,
    commitSha: suffix.repeat(40).slice(0, 40),
    workflowRunId: `run-${suffix}`,
    deploymentId: `dep-${suffix}`,
    revision: `dark-factory--${suffix}`,
    traceId: `4bf92f3577b34da6a3ce929d0e0e47${suffix}`.slice(0, 32),
    correlationId: `corr-${goalId}-${suffix}`,
    policyVerdict: verdict,
  };
}

export class UnconfiguredProductionAdapter implements FactoryOperationsAdapter {
  readonly source = "production" as const;

  getOverview(): Promise<FactoryOverviewResponse> {
    return Promise.reject(
      new Error(
        "Production factory adapter is not configured; provide an adapter or use demo mode",
      ),
    );
  }
}

export class DemoFactoryOperationsAdapter implements FactoryOperationsAdapter {
  readonly source = "demo" as const;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  getOverview(): Promise<FactoryOverviewResponse> {
    return Promise.resolve(createDemoOverview(this.clock()));
  }
}

function createDemoOverview(now: Date): FactoryOverviewResponse {
  const goals: GoalOutcome[] = [
    {
      completed: true,
      autonomous: true,
      leadTimeHours: 5.5,
      retries: 1,
      repairs: 1,
    },
    {
      completed: true,
      autonomous: true,
      leadTimeHours: 8.25,
      retries: 0,
      repairs: 0,
    },
    {
      completed: true,
      autonomous: false,
      leadTimeHours: 13,
      retries: 2,
      repairs: 1,
    },
    {
      completed: false,
      autonomous: true,
      leadTimeHours: 0,
      retries: 1,
      repairs: 0,
    },
  ];
  const reliability: ReliabilityOutcome[] = [
    {
      deployed: true,
      rolledBack: false,
      escapedDefects: 0,
      agentCostUsd: 2.35,
      runtimeCostUsd: 0.42,
    },
    {
      deployed: true,
      rolledBack: true,
      escapedDefects: 1,
      recoveryMinutes: 18,
      agentCostUsd: 3.1,
      runtimeCostUsd: 0.65,
    },
    {
      deployed: true,
      rolledBack: false,
      escapedDefects: 0,
      recoveryMinutes: 12,
      agentCostUsd: 1.8,
      runtimeCostUsd: 0.31,
    },
  ];
  const goal = correlation("goal-1042", "2");
  const incident = correlation("goal-1038", "3", "allow:auto-rollback");
  const auditEvents: AuditEvent[] = [
    {
      id: "audit-003",
      occurredAt: "2026-10-04T18:43:00.000Z",
      actor: "integration-controller",
      action: "merge-candidate",
      outcome: "allowed",
      detail: "Evidence and independent review gates passed.",
      correlation: goal,
    },
    {
      id: "audit-002",
      occurredAt: "2026-10-04T18:31:00.000Z",
      actor: "incident-controller",
      action: "rollback",
      outcome: "succeeded",
      detail: "Canary regression restored the previous healthy revision.",
      correlation: incident,
    },
    {
      id: "audit-001",
      occurredAt: "2026-10-04T18:29:00.000Z",
      actor: "policy-engine",
      action: "production-promotion",
      outcome: "denied",
      detail: "Error budget threshold exceeded.",
      correlation: { ...incident, policyVerdict: "deny:error-budget" },
    },
  ];

  return {
    generatedAt: now.toISOString(),
    source: "demo",
    metrics: calculateFactoryMetrics(goals, reliability),
    activeGoals: [
      {
        id: "goal-1042",
        title: "Harden factory operations",
        state: "reviewing",
        owner: "coding-agent",
        updatedAt: "2026-10-04T18:43:00.000Z",
        correlation: goal,
      },
      {
        id: "goal-1044",
        title: "Rotate deployment identity",
        state: "planning",
        owner: "operations-agent",
        updatedAt: "2026-10-04T18:40:00.000Z",
        correlation: correlation("goal-1044", "4"),
      },
    ],
    activeIncidents: [
      {
        id: "inc-208",
        severity: "sev2",
        title: "Canary latency regression",
        status: "monitoring",
        startedAt: "2026-10-04T18:27:00.000Z",
        correlation: incident,
      },
    ],
    deployments: [
      {
        id: "dep-2",
        environment: "production",
        status: "healthy",
        revision: goal.revision,
        deployedAt: "2026-10-04T18:45:00.000Z",
        correlation: goal,
      },
      {
        id: "dep-3",
        environment: "production",
        status: "rolled-back",
        revision: incident.revision,
        deployedAt: "2026-10-04T18:27:00.000Z",
        correlation: incident,
      },
    ],
    auditEvents,
  };
}
