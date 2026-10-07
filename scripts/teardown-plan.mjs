if (process.argv.includes("--apply")) {
  throw new Error(
    "Live teardown is intentionally unsupported. Execute the reviewed plan manually.",
  );
}

const repository = process.env.GITHUB_REPOSITORY ?? "<owner/repository>";
const resourceGroup = process.env.AZURE_RESOURCE_GROUP ?? "<resource-group>";
const plan = {
  mode: "dry-run-only",
  destructiveActionsExecuted: false,
  prerequisites: [
    "Export audit evidence and deployment history.",
    "Confirm traffic has moved to a replacement service.",
    "Retain container digests and database backups per policy.",
  ],
  github: [
    `Review repository settings for ${repository}; do not remove rules until autonomous workflows are disabled.`,
    "Disable schedules and repository_dispatch senders.",
    "Remove OIDC subjects only after Azure resources are retired.",
  ],
  azure: [
    `Inventory first: az resource list --resource-group ${resourceGroup} --output table.`,
    "Azure resource-group deletion has no what-if mode; review this inventory and the dependency graph before any approved manual delete.",
    "Review locks, private endpoints, role assignments, retained logs, and backup policies.",
    "Use Azure Portal/CLI manually only after change approval; this script never deletes.",
  ],
};

console.log(JSON.stringify(plan, null, 2));
