import { rm } from "node:fs/promises";

const paths = [
  "apps/api/dist",
  "apps/web/dist",
  "apps/worker/dist",
  "packages/contracts/dist",
  "packages/observability/dist",
  "packages/policy-engine/dist",
  "coverage",
];

await Promise.all(
  paths.map((path) => rm(path, { force: true, recursive: true })),
);
