import { generateKeyPairSync } from "node:crypto";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";
import adapterPackage from "../apps/alert-adapter/package.json" with { type: "json" };
import type { DeduplicationStore } from "../apps/alert-adapter/src/deduplication.js";
import {
  createGitHubAppJwt,
  GitHubAppDispatcher,
  type PrivateKeyProvider,
} from "../apps/alert-adapter/src/github.js";
import { createAlertHandler } from "../apps/alert-adapter/src/handler.js";
import {
  alertDeduplicationKey,
  normalizeAlert,
} from "../apps/alert-adapter/src/normalize.js";
import lockfile from "../package-lock.json" with { type: "json" };

describe("Azure alert adapter dependency pin", () => {
  it("keeps Identity on its supported MSAL Node 3.x dependency chain", () => {
    expect(adapterPackage.dependencies["@azure/identity"]).toBe("4.13.0");
    expect(
      lockfile.packages["apps/alert-adapter"].dependencies["@azure/identity"],
    ).toBe("4.13.0");
    const identityPackages = Object.entries(lockfile.packages).filter(
      ([path]) => path.endsWith("node_modules/@azure/identity"),
    );
    expect(identityPackages.length).toBeGreaterThan(0);
    for (const [, entry] of identityPackages) {
      expect(entry).toMatchObject({
        version: "4.13.0",
        dependencies: { "@azure/msal-node": "^3.5.0" },
      });
    }
  });

  it("does not restore the MSAL Node chain affected by GHSA-xcx6-jx8p-x3h5", () => {
    const msalPackages = Object.entries(lockfile.packages).filter(([path]) =>
      path.endsWith("node_modules/@azure/msal-node"),
    );

    expect(msalPackages.length).toBeGreaterThan(0);
    for (const [, entry] of msalPackages) {
      if (!("version" in entry)) {
        throw new Error("Expected the locked MSAL Node version.");
      }
      expect(entry.version).toMatch(/^3\.\d+\.\d+$/);
    }
  });
});

const commonPayload = {
  schemaId: "azureMonitorCommonAlertSchema",
  data: {
    essentials: {
      alertId:
        "/subscriptions/sub/providers/Microsoft.AlertsManagement/alerts/a1",
      alertRule: "container-app-error-rate",
      severity: "Sev1",
      signalType: "Log",
      monitorCondition: "Fired",
      monitoringService: "Log Alerts V2",
      alertTargetIDs: [
        "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/containerApps/api/revisions/api--abc123",
      ],
      firedDateTime: "2026-10-05T12:00:00Z",
    },
    alertContext: {
      condition: {
        allOf: [
          {
            dimensions: [
              { name: "commitSha", value: "a".repeat(40) },
              { name: "correlationId", value: "corr-42" },
              { name: "alertRuleId", value: "rule-17" },
            ],
          },
        ],
      },
    },
  },
};

class MemoryDeduplicationStore implements DeduplicationStore {
  public readonly claimed = new Set<string>();
  public released: string[] = [];
  public completed: string[] = [];

  public tryClaim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return Promise.resolve(false);
    this.claimed.add(key);
    return Promise.resolve(true);
  }

  public complete(key: string): Promise<void> {
    this.completed.push(key);
    return Promise.resolve();
  }

  public release(key: string): Promise<void> {
    this.claimed.delete(key);
    this.released.push(key);
    return Promise.resolve();
  }
}

describe("Azure alert adapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  const targetEnvironment = {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_INSTALLATION_ID: "67890",
    GITHUB_REPOSITORY_OWNER: "example-org",
    GITHUB_REPOSITORY_NAME: "example-repo",
    KEY_VAULT_URI: "https://example.vault.azure.net",
  };

  it.each(
    Object.keys(targetEnvironment).filter((name) => name !== "KEY_VAULT_URI"),
  )(
    "refuses a missing or blank %s instead of dispatching to the demo account",
    (name) => {
      for (const [key, value] of Object.entries(targetEnvironment)) {
        vi.stubEnv(key, value);
      }
      for (const value of [undefined, "", "   "]) {
        vi.stubEnv(name, value);
        expect(() => GitHubAppDispatcher.fromEnvironment()).toThrow(
          `${name} is required.`,
        );
      }
    },
  );

  it("uses explicitly configured targets without accessing Key Vault", () => {
    for (const [key, value] of Object.entries(targetEnvironment)) {
      vi.stubEnv(key, value);
    }
    expect(GitHubAppDispatcher.fromEnvironment()).toBeInstanceOf(
      GitHubAppDispatcher,
    );
  });

  it("normalizes and enriches Container Apps common-alert-schema payloads", () => {
    const alert = normalizeAlert(commonPayload);

    expect(alert).toMatchObject({
      eventType: "container-apps-alert",
      correlationId: "corr-42",
      commitSha: "a".repeat(40),
      containerAppsRevision: "api--abc123",
      rule: { name: "container-app-error-rate", id: "rule-17" },
      severity: { azure: "Sev1", normalized: "high", priority: 1 },
    });
    expect(alertDeduplicationKey(alert)).toHaveLength(64);
  });

  it("rejects payloads that are not Azure Monitor common alert schema", () => {
    expect(() => normalizeAlert({ data: { essentials: {} } })).toThrow(
      /essentials\.alertId/,
    );
  });

  it("deduplicates retries and dispatches only the first delivery", async () => {
    const store = new MemoryDeduplicationStore();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const handler = createAlertHandler({
      deduplicationStore: store,
      dispatcher: { dispatch },
      now: () => new Date("2026-10-05T12:00:00Z"),
    });
    const context = new InvocationContext({ functionName: "test" });

    const first = await handler(
      new HttpRequest({
        url: "https://example.test/api/alerts/azure-monitor",
        method: "POST",
        body: { string: JSON.stringify(commonPayload) },
      }),
      context,
    );
    const retry = await handler(
      new HttpRequest({
        url: "https://example.test/api/alerts/azure-monitor",
        method: "POST",
        body: { string: JSON.stringify(commonPayload) },
      }),
      context,
    );

    expect(first).toMatchObject({
      status: 202,
      jsonBody: { duplicate: false, eventType: "container-apps-alert" },
    });
    expect(retry).toMatchObject({
      status: 202,
      jsonBody: { duplicate: true },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(store.completed).toHaveLength(1);
  });

  it("releases the claim when GitHub dispatch fails", async () => {
    const store = new MemoryDeduplicationStore();
    const handler = createAlertHandler({
      deduplicationStore: store,
      dispatcher: {
        dispatch: vi.fn().mockRejectedValue(new Error("GitHub unavailable")),
      },
    });

    await expect(
      handler(
        new HttpRequest({
          url: "https://example.test/api/alerts/azure-monitor",
          method: "POST",
          body: { string: JSON.stringify(commonPayload) },
        }),
        new InvocationContext({ functionName: "test" }),
      ),
    ).rejects.toThrow("GitHub unavailable");
    expect(store.released).toHaveLength(1);
  });

  it("mints an installation token and sends repository_dispatch", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const keyProvider: PrivateKeyProvider = {
      getPrivateKey: vi.fn().mockResolvedValue(privateKey),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "installation-token" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const dispatcher = new GitHubAppDispatcher(
      {
        appId: "5122991",
        installationId: "168176539",
        owner: "The-weyland-yutani-corporation",
        repository: "dark-factory-demo",
      },
      keyProvider,
      request,
    );
    const alert = normalizeAlert(commonPayload);

    await dispatcher.dispatch(alert);

    expect(createGitHubAppJwt("5122991", privateKey).split(".")).toHaveLength(
      3,
    );
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/app/installations/168176539/access_tokens",
      expect.objectContaining({ method: "POST" }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/The-weyland-yutani-corporation/dark-factory-demo/dispatches",
      expect.objectContaining({ method: "POST" }),
    );
    const dispatchBody = request.mock.calls[1]?.[1]?.body;
    if (typeof dispatchBody !== "string") {
      throw new Error("Expected repository dispatch body to be a string.");
    }
    expect(dispatchBody).toContain('"event_type":"container-apps-alert"');
  });
});
