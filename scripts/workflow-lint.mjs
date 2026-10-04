import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";

const workflowRoot = ".github/workflows";
const requestedFiles = new Set(process.argv.slice(2));
const files = (await readdir(workflowRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name))
  .filter((entry) => !/\.lock\.(?:yml|yaml)$/i.test(entry.name))
  .map((entry) => path.join(workflowRoot, entry.name))
  .filter(
    (file) =>
      requestedFiles.size === 0 ||
      requestedFiles.has(path.basename(file)) ||
      requestedFiles.has(file),
  )
  .sort();

if (files.length === 0) throw new Error("No conventional workflows found");

const errors = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  const document = parseDocument(content, { prettyErrors: true });
  if (document.errors.length > 0) {
    errors.push(...document.errors.map((error) => `${file}: ${error.message}`));
    continue;
  }
  const workflow = document.toJS();
  if (!workflow.name) errors.push(`${file}: workflow name is required`);
  if (!workflow.on) errors.push(`${file}: trigger is required`);
  if (!workflow.permissions)
    errors.push(`${file}: top-level least-privilege permissions are required`);
  if (!workflow.concurrency)
    errors.push(`${file}: concurrency cancellation policy is required`);
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    if (!job.uses && !job["timeout-minutes"])
      errors.push(`${file}: job ${jobName} needs timeout-minutes`);
  }
  for (const match of content.matchAll(/uses:\s*([^\s#]+)/g)) {
    const reference = match[1];
    if (!reference.startsWith("./") && !/@[a-f0-9]{40}$/i.test(reference)) {
      errors.push(
        `${file}: action is not pinned to a commit SHA: ${reference}`,
      );
    }
  }
}

if (errors.length > 0) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} workflow files.`);
}
