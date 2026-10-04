import { buildApp } from "../apps/api/src/app.js";
import { deliveryProbeRequest } from "../scripts/delivery/lib.mjs";
import { afterEach, describe, expect, it } from "vitest";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("API contract", () => {
  it("accepts the production delivery probe", async () => {
    const app = buildApp({ logger: false, webRoot: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/policies/evaluate",
      payload: deliveryProbeRequest("a".repeat(40)),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision: { action: "deny" },
      evaluatedRules: 0,
      correlation: {
        commitSha: "a".repeat(40),
        policyVerdict: "deny:default",
      },
    });
  });

  it("keeps operational responses JSON-compatible and rejects extra fields", async () => {
    const app = buildApp({
      logger: false,
      webRoot: false,
      clock: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    apps.push(app);

    const health = await app.inject({ method: "GET", url: "/healthz" });
    const invalidPolicy = await app.inject({
      method: "POST",
      url: "/api/policies/evaluate",
      payload: {
        defaultAction: "deny",
        context: {
          subject: "agent",
          resource: "production",
          attributes: {},
        },
      },
    });

    expect(health.headers["content-type"]).toMatch(/^application\/json/);
    expect(health.json()).toEqual({
      status: "ok",
      service: "dark-factory-api",
      timestamp: "2026-01-02T03:04:05.000Z",
    });
    expect(invalidPolicy.statusCode).toBe(400);
  });
});
