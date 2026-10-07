import { buildApp } from "../apps/api/src/app.js";
import type { FactoryOverviewResponse } from "@dark-factory/contracts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const apps: ReturnType<typeof buildApp>[] = [];
const webFixture = path.resolve("reports/test-web");
const correlation = {
  goalId: "goal-test",
  pullRequest: "#1",
  commitSha: "a".repeat(40),
  workflowRunId: "run-1",
  deploymentId: "dep-1",
  revision: "revision-1",
  traceId: "b".repeat(32),
  correlationId: "corr-1",
  policyVerdict: "pending",
};

beforeAll(async () => {
  await mkdir(webFixture, { recursive: true });
  await writeFile(`${webFixture}/index.html`, "<h1>Control Room</h1>");
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

afterAll(async () => {
  await rm(webFixture, { recursive: true, force: true });
});

describe("API operational endpoints", () => {
  it("reports health and version metadata", async () => {
    const app = buildApp({
      version: "test-version",
      commit: "abc123",
      clock: () => new Date("2026-01-02T03:04:05.000Z"),
      logger: false,
      webRoot: false,
    });
    apps.push(app);

    const health = await app.inject({ method: "GET", url: "/healthz" });
    const version = await app.inject({ method: "GET", url: "/version" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      service: "dark-factory-api",
      timestamp: "2026-01-02T03:04:05.000Z",
    });
    expect(version.json()).toMatchObject({
      service: "dark-factory-api",
      version: "test-version",
      node: process.version,
      commit: "abc123",
    });
  });

  it("returns 503 when readiness is disabled", async () => {
    const app = buildApp({
      readinessEnabled: false,
      logger: false,
      webRoot: false,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "not-ready",
      checks: { api: false },
    });
  });

  it("evaluates policy requests and validates malformed input", async () => {
    const app = buildApp({ logger: false, webRoot: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/policies/evaluate",
      payload: {
        defaultAction: "deny",
        context: {
          subject: "agent",
          resource: "production",
          attributes: { risk: "low" },
        },
        rules: [
          {
            id: "allow-low-risk",
            description: "Approved risk",
            action: "allow",
            priority: 10,
            conditions: { risk: "low" },
          },
        ],
        correlation,
      },
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/api/policies/evaluate",
      payload: { defaultAction: "maybe" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      decision: {
        action: "allow",
        matchedRuleId: "allow-low-risk",
        reason: "Approved risk",
      },
      evaluatedRules: 1,
      correlation: {
        ...correlation,
        policyVerdict: "allow:allow-low-risk",
      },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("returns the deterministic factory overview and correlation ledger", async () => {
    const app = buildApp({
      logger: false,
      webRoot: false,
      clock: () => new Date("2026-10-04T18:49:41.000Z"),
    });

    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/factory/overview",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      generatedAt: "2026-10-04T18:49:41.000Z",
      source: "demo",
      metrics: {
        throughputPerWeek: 3,
        autonomousCompletionRate: 66.67,
        retryCount: 4,
        repairCount: 2,
        rollbackRate: 33.33,
        escapedDefects: 1,
        mttrMinutes: 15,
        estimatedAgentCostUsd: 7.25,
        estimatedRuntimeCostUsd: 1.38,
      },
    });
    const body = response.json<FactoryOverviewResponse>();
    for (const event of body.auditEvents) {
      expect(Object.values(event.correlation)).not.toContain("");
    }
  });

  it("fails closed when production data is not configured", async () => {
    const app = buildApp({
      logger: false,
      webRoot: false,
      factoryDataMode: "production",
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/factory/overview",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "Factory data unavailable",
      statusCode: 503,
    });
  });

  it("serves the web shell and preserves JSON API 404 responses", async () => {
    const app = buildApp({
      logger: false,
      corsOrigin: false,
      webRoot: webFixture,
    });
    apps.push(app);

    const shell = await app.inject({ method: "GET", url: "/dashboard" });
    const missingApi = await app.inject({
      method: "GET",
      url: "/api/missing",
    });

    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain("Control Room");
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toMatchObject({ error: "Not Found" });
  });
});
