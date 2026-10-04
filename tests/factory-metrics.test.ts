import {
  calculateFactoryMetrics,
  validateCorrelation,
} from "../apps/api/src/factory-data.js";
import { describe, expect, it } from "vitest";

describe("factory metrics", () => {
  it("returns safe zeroes for empty datasets", () => {
    expect(calculateFactoryMetrics([], [])).toEqual({
      throughputPerWeek: 0,
      goalLeadTimeHours: 0,
      autonomousCompletionRate: 0,
      retryCount: 0,
      repairCount: 0,
      rollbackRate: 0,
      escapedDefects: 0,
      mttrMinutes: 0,
      estimatedAgentCostUsd: 0,
      estimatedRuntimeCostUsd: 0,
    });
  });

  it("rounds rates and costs deterministically", () => {
    const metrics = calculateFactoryMetrics(
      [
        {
          completed: true,
          autonomous: true,
          leadTimeHours: 1,
          retries: 1,
          repairs: 2,
        },
        {
          completed: true,
          autonomous: false,
          leadTimeHours: 2,
          retries: 0,
          repairs: 0,
        },
        {
          completed: true,
          autonomous: false,
          leadTimeHours: 4,
          retries: 0,
          repairs: 0,
        },
      ],
      [
        {
          deployed: true,
          rolledBack: true,
          escapedDefects: 2,
          recoveryMinutes: 11,
          agentCostUsd: 0.105,
          runtimeCostUsd: 0.204,
        },
        {
          deployed: true,
          rolledBack: false,
          escapedDefects: 0,
          recoveryMinutes: 14,
          agentCostUsd: 0.105,
          runtimeCostUsd: 0.204,
        },
      ],
    );

    expect(metrics).toMatchObject({
      goalLeadTimeHours: 2.33,
      autonomousCompletionRate: 33.33,
      rollbackRate: 50,
      mttrMinutes: 12.5,
      estimatedAgentCostUsd: 0.21,
      estimatedRuntimeCostUsd: 0.41,
    });
  });

  it("reports every missing correlation field", () => {
    expect(
      validateCorrelation({
        goalId: "",
        pullRequest: "#1",
        commitSha: "",
        workflowRunId: "run",
        deploymentId: "dep",
        revision: "rev",
        traceId: "",
        correlationId: "corr",
        policyVerdict: "allow",
      }),
    ).toEqual(["goalId", "commitSha", "traceId"]);
  });
});
