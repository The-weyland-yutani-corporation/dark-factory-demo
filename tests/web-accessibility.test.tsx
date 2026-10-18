// @vitest-environment jsdom
import { App } from "../apps/web/src/App.js";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Control Room accessibility", () => {
  it("renders a labelled, axe-clean status experience", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const path =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const body = path.endsWith("/healthz")
          ? {
              status: "ok",
              service: "dark-factory-api",
              timestamp: "2026-01-02T03:04:05.000Z",
            }
          : path.endsWith("/readyz")
            ? { status: "ready", checks: { api: true } }
            : path.endsWith("/version")
              ? {
                  service: "dark-factory-api",
                  version: "test",
                  node: "v22",
                  commit: null,
                }
              : path.endsWith("/api/factory/overview")
                ? {
                    generatedAt: "2026-10-04T18:49:41.000Z",
                    source: "demo",
                    metrics: {
                      throughputPerWeek: 3,
                      goalLeadTimeHours: 8.92,
                      autonomousCompletionRate: 66.67,
                      retryCount: 4,
                      repairCount: 2,
                      rollbackRate: 33.33,
                      escapedDefects: 1,
                      mttrMinutes: 15,
                      estimatedAgentCostUsd: 7.25,
                      estimatedRuntimeCostUsd: 1.38,
                    },
                    activeGoals: [],
                    activeIncidents: [],
                    deployments: [],
                    auditEvents: [],
                  }
                : {
                    decision: {
                      action: "allow",
                      matchedRuleId: "allow-low-risk",
                      reason: "Approved",
                    },
                    evaluatedRules: 1,
                  };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    const { container } = render(<App />);

    await waitFor(() =>
      expect(screen.getByText("dark-factory-api")).toBeInTheDocument(),
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Demo limitations" }),
    ).toHaveTextContent("Synthetic demo data");
    expect(
      screen.getByRole("button", { name: "Refresh status" }),
    ).toBeEnabled();
    expect((await axe(container)).violations).toEqual([]);
  });
});
