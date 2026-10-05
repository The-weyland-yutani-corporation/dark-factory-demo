import { readFile } from "node:fs/promises";

const dockerfile = await readFile("Dockerfile", "utf8");
const errors = [];
const fromLines = dockerfile.match(/^FROM\s+.+$/gim) ?? [];

if (fromLines.length === 0) errors.push("Dockerfile needs at least one FROM");
if (fromLines.some((line) => /:latest(?:\s|$)/i.test(line)))
  errors.push("Dockerfile must not use latest tags");
if (!/^USER\s+(?!root\b)\S+/im.test(dockerfile))
  errors.push("runtime image must set a non-root USER");
if (!/^HEALTHCHECK\s+/im.test(dockerfile))
  errors.push("runtime image must define a HEALTHCHECK");
if (!/npm\s+ci\b/.test(dockerfile))
  errors.push("container dependencies must use npm ci");
if (!/npm\s+(?:prune|ci)[\s\S]{0,160}--omit=dev/.test(dockerfile))
  errors.push("runtime dependencies must omit development packages");

if (errors.length > 0) {
  errors.forEach((error) => console.error(`container: ${error}`));
  process.exitCode = 1;
} else {
  console.log("Dockerfile policy passed.");
}
