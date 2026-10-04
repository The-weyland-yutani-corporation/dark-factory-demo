import type {
  ApiErrorResponse,
  FactoryOverviewResponse,
  HealthResponse,
  PolicyEvaluationRequest,
  PolicyEvaluationResponse,
  ReadinessResponse,
  VersionResponse,
} from "@dark-factory/contracts";
import { evaluatePolicy } from "@dark-factory/policy-engine";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DemoFactoryOperationsAdapter,
  type FactoryOperationsAdapter,
  UnconfiguredProductionAdapter,
  validateCorrelation,
} from "./factory-data.js";

export interface ApiOptions {
  readonly version?: string;
  readonly readinessEnabled?: boolean;
  readonly logger?: boolean;
  readonly clock?: () => Date;
  readonly commit?: string;
  readonly webRoot?: string | false;
  readonly corsOrigin?: string | false;
  readonly factoryAdapter?: FactoryOperationsAdapter;
  readonly factoryDataMode?: "demo" | "production";
}

export function buildApp(options: ApiOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const service = "dark-factory-api";
  const version = options.version ?? process.env.APP_VERSION ?? "0.1.0";
  const commit = options.commit ?? process.env.GIT_COMMIT ?? null;
  const clock = options.clock ?? (() => new Date());
  const readinessEnabled =
    options.readinessEnabled ??
    process.env.READINESS_ENABLED?.toLowerCase() !== "false";
  const corsOrigin =
    options.corsOrigin ?? process.env.CORS_ORIGIN ?? "http://localhost:5173";
  const defaultWebRoot = fileURLToPath(
    new URL("../../web/dist", import.meta.url),
  );
  const webRoot = options.webRoot ?? defaultWebRoot;
  const dataMode =
    options.factoryDataMode ?? process.env.FACTORY_DATA_MODE ?? "demo";
  const factoryAdapter =
    options.factoryAdapter ??
    (dataMode === "production"
      ? new UnconfiguredProductionAdapter()
      : new DemoFactoryOperationsAdapter(clock));

  if (corsOrigin !== false && corsOrigin !== "false") {
    void app.register(cors, { origin: corsOrigin });
  }

  app.get<{ Reply: HealthResponse }>("/healthz", () => ({
    status: "ok",
    service,
    timestamp: clock().toISOString(),
  }));

  app.get<{ Reply: ReadinessResponse }>("/readyz", (_request, reply) => {
    if (!readinessEnabled) {
      void reply.code(503);
    }
    return {
      status: readinessEnabled ? "ready" : "not-ready",
      checks: { api: readinessEnabled },
    };
  });

  app.get<{ Reply: VersionResponse }>("/version", () => ({
    service,
    version,
    node: process.version,
    commit,
  }));

  app.get<{ Reply: FactoryOverviewResponse }>(
    "/api/factory/overview",
    async (_request, reply) => {
      try {
        return await factoryAdapter.getOverview();
      } catch (error) {
        app.log.error(error);
        return reply.code(503).send({
          error: "Factory data unavailable",
          message: error instanceof Error ? error.message : String(error),
          statusCode: 503,
        } as never);
      }
    },
  );

  app.post<{
    Body: PolicyEvaluationRequest;
    Reply: PolicyEvaluationResponse | ApiErrorResponse;
  }>(
    "/api/policies/evaluate",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["context", "rules", "defaultAction", "correlation"],
          properties: {
            defaultAction: { enum: ["allow", "deny"] },
            context: {
              type: "object",
              additionalProperties: false,
              required: ["subject", "resource", "attributes"],
              properties: {
                subject: { type: "string", minLength: 1 },
                resource: { type: "string", minLength: 1 },
                attributes: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
            },
            rules: {
              type: "array",
              maxItems: 1000,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "id",
                  "description",
                  "action",
                  "priority",
                  "conditions",
                ],
                properties: {
                  id: { type: "string", minLength: 1 },
                  description: { type: "string", minLength: 1 },
                  action: { enum: ["allow", "deny"] },
                  priority: { type: "integer" },
                  conditions: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
              },
            },
            correlation: {
              type: "object",
              additionalProperties: false,
              required: [
                "goalId",
                "pullRequest",
                "commitSha",
                "workflowRunId",
                "deploymentId",
                "revision",
                "traceId",
                "correlationId",
                "policyVerdict",
              ],
              properties: Object.fromEntries(
                [
                  "goalId",
                  "pullRequest",
                  "commitSha",
                  "workflowRunId",
                  "deploymentId",
                  "revision",
                  "traceId",
                  "correlationId",
                  "policyVerdict",
                ].map((name) => [name, { type: "string", minLength: 1 }]),
              ),
            },
          },
        },
      },
    },
    (request, reply) => {
      const missing = validateCorrelation(request.body.correlation);
      if (missing.length > 0) {
        void reply.code(400);
        return {
          error: "Invalid correlation",
          message: `Missing correlation fields: ${missing.join(", ")}`,
          statusCode: 400,
        };
      }
      const decision = evaluatePolicy(
        {
          rules: request.body.rules,
          defaultAction: request.body.defaultAction,
        },
        request.body.context,
      );
      return {
        decision,
        evaluatedRules: request.body.rules.length,
        correlation: {
          ...request.body.correlation,
          policyVerdict: `${decision.action}:${decision.matchedRuleId ?? "default"}`,
        },
      };
    },
  );

  if (webRoot !== false && existsSync(webRoot)) {
    void app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({
        error: "Not Found",
        message: "Route not found",
        statusCode: 404,
      });
    });
  }

  return app;
}
