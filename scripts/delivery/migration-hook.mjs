import { azJson, required } from "./lib.mjs";

const jobName = process.env.MIGRATION_JOB_NAME?.trim();
if (!jobName) {
  console.log(
    "No migration job configured. Set MIGRATION_JOB_NAME to run a backwards-compatible Container Apps Job before traffic is shifted.",
  );
  process.exit(0);
}

const resourceGroup = required("AZURE_RESOURCE_GROUP");
const timeoutSeconds = Number.parseInt(
  process.env.MIGRATION_TIMEOUT_SECONDS ?? "900",
  10,
);
const execution = azJson([
  "containerapp",
  "job",
  "start",
  "--name",
  jobName,
  "--resource-group",
  resourceGroup,
]);
const executionName = execution?.name;
if (!executionName)
  throw new Error("Azure did not return a migration execution name");

const deadline = Date.now() + timeoutSeconds * 1_000;
while (Date.now() < deadline) {
  const current = azJson([
    "containerapp",
    "job",
    "execution",
    "show",
    "--name",
    jobName,
    "--resource-group",
    resourceGroup,
    "--job-execution-name",
    executionName,
  ]);
  const status = current?.properties?.status;
  console.log(`Migration ${executionName}: ${status}`);
  if (status === "Succeeded") process.exit(0);
  if (status === "Failed" || status === "Stopped") {
    throw new Error(`Migration ${executionName} ended with ${status}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
throw new Error(
  `Migration ${executionName} exceeded ${timeoutSeconds} seconds`,
);
