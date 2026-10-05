import { app } from "@azure/functions";
import { TableDeduplicationStore } from "../deduplication.js";
import { GitHubAppDispatcher } from "../github.js";
import { createAlertHandler } from "../handler.js";

export const azureMonitorAlert = createAlertHandler({
  deduplicationStore: TableDeduplicationStore.fromEnvironment(),
  dispatcher: GitHubAppDispatcher.fromEnvironment(),
});

app.http("azure-monitor-alert", {
  route: "alerts/azure-monitor",
  methods: ["POST"],
  authLevel: "function",
  handler: azureMonitorAlert,
});
