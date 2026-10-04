import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function bicepFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await bicepFiles(candidate)));
    else if (entry.name.endsWith(".bicep")) result.push(candidate);
  }
  return result;
}

const files = (await bicepFiles("infra")).sort();
const config = JSON.parse(await readFile("infra/bicepconfig.json", "utf8"));
const errors = [];

if (config.analyzers?.core?.enabled !== true)
  errors.push("Bicep core analyzer must be enabled");

for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/resource\s+\w+\s+'[^']+@([^']+)'/g)) {
    if (!/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(match[1]))
      errors.push(`${file}: resource API version must be explicit`);
  }
  if (/@secure\(\)[\s\S]{0,120}param\s+\w+\s+\w+\s*=\s*['"]/m.test(content))
    errors.push(`${file}: secure parameters must not have literal defaults`);
  if (/\b(listKeys|listSecrets)\s*\(/i.test(content))
    errors.push(`${file}: avoid exposing deployment-time secrets`);
}

if (files.length < 2) errors.push("Expected a modular Bicep design");

if (errors.length > 0) {
  errors.forEach((error) => console.error(`iac: ${error}`));
  process.exitCode = 1;
} else {
  console.log(`IaC policy passed for ${files.length} Bicep files.`);
}
