import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { alertDeduplicationKey, normalizeAlert } from "./normalize.js";
import type { DeduplicationStore } from "./deduplication.js";
import type { GitHubDispatcher } from "./github.js";

export interface AlertHandlerDependencies {
  deduplicationStore: DeduplicationStore;
  dispatcher: GitHubDispatcher;
  now?: () => Date;
}

export function createAlertHandler(dependencies: AlertHandlerDependencies) {
  return async function handleAzureMonitorAlert(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return {
        status: 400,
        jsonBody: { error: "Request body must be valid JSON." },
      };
    }

    let alert;
    try {
      alert = normalizeAlert(payload);
    } catch (error) {
      return {
        status: 400,
        jsonBody: {
          error:
            error instanceof Error ? error.message : "Invalid alert payload.",
        },
      };
    }

    const key = alertDeduplicationKey(alert);
    const now = dependencies.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const claimed = await dependencies.deduplicationStore.tryClaim(
      key,
      expiresAt,
    );
    if (!claimed) {
      context.log("Ignored duplicate Azure Monitor alert.", {
        alertId: alert.alertId,
        correlationId: alert.correlationId,
        status: alert.status,
      });
      return {
        status: 202,
        jsonBody: { accepted: true, duplicate: true },
      };
    }

    try {
      await dependencies.dispatcher.dispatch(alert);
      await dependencies.deduplicationStore.complete(key);
      context.log("Dispatched Azure Monitor alert to GitHub.", {
        alertId: alert.alertId,
        correlationId: alert.correlationId,
        eventType: alert.eventType,
      });
      return {
        status: 202,
        jsonBody: {
          accepted: true,
          duplicate: false,
          eventType: alert.eventType,
          correlationId: alert.correlationId,
        },
      };
    } catch (error) {
      await dependencies.deduplicationStore.release(key);
      context.error("Azure Monitor alert dispatch failed.", {
        alertId: alert.alertId,
        correlationId: alert.correlationId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  };
}
