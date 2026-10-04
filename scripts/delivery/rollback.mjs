import { azJson, azTsv, observe, required, writeOutput } from "./lib.mjs";

const resourceGroup = required("AZURE_RESOURCE_GROUP");
const appName = required("AZURE_CONTAINER_APP_NAME");
const requestedTarget = process.env.TARGET_REVISION?.trim();
const revisions = azJson([
  "containerapp",
  "revision",
  "list",
  "--name",
  appName,
  "--resource-group",
  resourceGroup,
]);
const active = revisions
  .filter((item) => item.properties?.active)
  .sort(
    (left, right) =>
      new Date(right.properties.createdTime) -
      new Date(left.properties.createdTime),
  );
const current = [...active].sort(
  (left, right) =>
    Number(right.properties?.trafficWeight ?? 0) -
    Number(left.properties?.trafficWeight ?? 0),
)[0];
const target = requestedTarget
  ? active.find((item) => item.name === requestedTarget)
  : Number(current?.properties?.trafficWeight) < 100
    ? current
    : active.find((item) => item.name !== current?.name);
if (!target) throw new Error("No previous active revision is available");

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
  ...active.map(
    (item) => `${item.name}=${item.name === target.name ? 100 : 0}`,
  ),
]);

const fqdn = azTsv([
  "containerapp",
  "show",
  "--name",
  appName,
  "--resource-group",
  resourceGroup,
  "--query",
  "properties.configuration.ingress.fqdn",
]);
const url = `https://${fqdn}`;
await observe(
  url,
  Number.parseInt(process.env.OBSERVATION_SECONDS ?? "60", 10),
);
await writeOutput("revision", target.name);
await writeOutput("environment_url", url);
