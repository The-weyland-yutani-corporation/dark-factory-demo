import { spawnSync } from "node:child_process";
import {
  azJson,
  azTsv,
  observe,
  required,
  verifyEndpoint,
  writeOutput,
  writeState,
} from "./lib.mjs";

const resourceGroup = required("AZURE_RESOURCE_GROUP");
const appName = required("AZURE_CONTAINER_APP_NAME");
const imageRef = required("IMAGE_REF");
const commit = required("COMMIT_SHA");
if (!/^[a-f0-9]{40}$/i.test(commit)) {
  throw new Error("COMMIT_SHA must be a 40-character Git commit SHA");
}
if (!/@sha256:[a-f0-9]{64}$/i.test(imageRef)) {
  throw new Error(
    "IMAGE_REF must be immutable and end in @sha256:<64 hex chars>",
  );
}

const steps = (process.env.TRAFFIC_STEPS ?? "5,25,50,100")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10));
if (
  steps.length === 0 ||
  steps.some((value) => !Number.isInteger(value) || value < 1 || value > 100) ||
  steps.at(-1) !== 100
) {
  throw new Error("TRAFFIC_STEPS must be ascending percentages ending in 100");
}
const observationSeconds = Number.parseInt(
  process.env.OBSERVATION_SECONDS ?? "60",
  10,
);
const suffix = `sha-${commit
  .toLowerCase()
  .replace(/[^a-f0-9]/g, "")
  .slice(0, 12)}`;

azTsv([
  "containerapp",
  "revision",
  "set-mode",
  "--name",
  appName,
  "--resource-group",
  resourceGroup,
  "--mode",
  "multiple",
]);

const appState = azJson([
  "containerapp",
  "show",
  "--name",
  appName,
  "--resource-group",
  resourceGroup,
]);
const before = appState?.properties?.configuration?.ingress?.traffic ?? [];
const baseline =
  [...before]
    .filter((entry) => Number(entry.weight) > 0)
    .sort((left, right) => Number(right.weight) - Number(left.weight))[0]
    ?.revisionName ?? appState?.properties?.latestRevisionName;
if (!baseline) throw new Error("No live baseline revision was found");
azTsv([
  "containerapp",
  "ingress",
  "traffic",
  "set",
  "--name",
  appName,
  "--resource-group",
  resourceGroup,
  "--revision-weight",
  `${baseline}=100`,
]);

let revision;
try {
  const revisions = azJson([
    "containerapp",
    "revision",
    "list",
    "--name",
    appName,
    "--resource-group",
    resourceGroup,
  ]);
  const existing = revisions.find(
    (item) => item.name === `${appName}--${suffix}`,
  );
  if (existing) {
    const existingImage = existing.properties?.template?.containers?.[0]?.image;
    if (existingImage !== imageRef) {
      throw new Error(`Revision ${existing.name} uses a different image`);
    }
    revision = existing.name;
    if (!existing.properties?.active) {
      azTsv([
        "containerapp",
        "revision",
        "activate",
        "--name",
        appName,
        "--resource-group",
        resourceGroup,
        "--revision",
        revision,
      ]);
    }
  } else {
    azTsv([
      "containerapp",
      "update",
      "--name",
      appName,
      "--resource-group",
      resourceGroup,
      "--image",
      imageRef,
      "--revision-suffix",
      suffix,
    ]);
    revision = azTsv([
      "containerapp",
      "show",
      "--name",
      appName,
      "--resource-group",
      resourceGroup,
      "--query",
      "properties.latestRevisionName",
    ]);
  }
  if (!revision) throw new Error("Container Apps did not create a revision");

  const revisionFqdn = azTsv([
    "containerapp",
    "revision",
    "show",
    "--name",
    appName,
    "--resource-group",
    resourceGroup,
    "--revision",
    revision,
    "--query",
    "properties.fqdn",
  ]);
  const appFqdn = azTsv([
    "containerapp",
    "show",
    "--name",
    appName,
    "--resource-group",
    resourceGroup,
    "--query",
    "properties.configuration.ingress.fqdn",
  ]);
  const revisionUrl = `https://${revisionFqdn}`;
  const appUrl = `https://${appFqdn}`;

  await writeState({
    resourceGroup,
    appName,
    baseline,
    revision,
    imageRef,
    commit,
  });
  await verifyEndpoint(revisionUrl, { expectedCommit: commit });
  if (revision === baseline) {
    console.log(
      `${revision} already serves production; no traffic change needed`,
    );
    await observe(appUrl, observationSeconds, commit);
    await writeOutput("revision", revision);
    await writeOutput("baseline_revision", baseline);
    await writeOutput("environment_url", appUrl);
    process.exit(0);
  }

  const migration = spawnSync(
    process.execPath,
    ["scripts/delivery/migration-hook.mjs"],
    { stdio: "inherit", env: process.env },
  );
  if (migration.status !== 0) throw new Error("Migration hook failed");
  await verifyEndpoint(revisionUrl, { expectedCommit: commit });

  for (const weight of steps) {
    console.log(`Shifting ${weight}% of traffic to ${revision}`);
    azTsv([
      "containerapp",
      "ingress",
      "traffic",
      "set",
      "--name",
      appName,
      "--resource-group",
      resourceGroup,
      "--revision-weight",
      `${baseline}=${100 - weight}`,
      `${revision}=${weight}`,
    ]);
    await observe(
      appUrl,
      observationSeconds,
      weight === 100 ? commit : undefined,
    );
  }

  await writeOutput("revision", revision);
  await writeOutput("baseline_revision", baseline);
  await writeOutput("environment_url", appUrl);
} catch (error) {
  console.error(`Delivery failed: ${error.message}`);
  if (baseline) {
    console.error(`Rolling traffic back to ${baseline}`);
    azTsv([
      "containerapp",
      "ingress",
      "traffic",
      "set",
      "--name",
      appName,
      "--resource-group",
      resourceGroup,
      "--revision-weight",
      `${baseline}=100`,
      ...(revision ? [`${revision}=0`] : []),
    ]);
    if (revision) {
      azTsv([
        "containerapp",
        "revision",
        "deactivate",
        "--name",
        appName,
        "--resource-group",
        resourceGroup,
        "--revision",
        revision,
      ]);
    }
  }
  throw error;
}
