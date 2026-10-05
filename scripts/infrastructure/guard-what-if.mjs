import { readFile, writeFile } from "node:fs/promises";

const allowedChangeTypes = new Set(["Create", "Deploy", "Modify", "NoChange"]);

export function evaluateWhatIf(result) {
  const changes = Array.isArray(result?.changes) ? result.changes : [];
  const reasons = [];

  if (!Array.isArray(result?.changes)) {
    reasons.push("what-if output does not contain a changes array");
  }

  for (const change of changes) {
    const resourceId = change.resourceId ?? "<unknown-resource>";
    if (!allowedChangeTypes.has(change.changeType)) {
      reasons.push(
        `${resourceId} has forbidden or unsupported change type ${change.changeType ?? "<missing>"}`,
      );
    }

    for (const delta of change.delta ?? []) {
      if (["Delete", "Unsupported"].includes(delta.propertyChangeType)) {
        reasons.push(
          `${resourceId}${delta.path ?? ""} has forbidden property change ${delta.propertyChangeType}`,
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    allowed: reasons.length === 0,
    reasons,
    summary: Object.fromEntries(
      [...allowedChangeTypes, "Delete", "Ignore", "Unsupported"].map((type) => [
        type,
        changes.filter((change) => change.changeType === type).length,
      ]),
    ),
  };
}

async function main() {
  const [input = "reports/infrastructure/what-if.json", output] =
    process.argv.slice(2);
  const result = JSON.parse(await readFile(input, "utf8"));
  const verdict = evaluateWhatIf(result);
  const content = `${JSON.stringify(verdict, null, 2)}\n`;
  if (output) await writeFile(output, content);
  process.stdout.write(content);
  if (!verdict.allowed) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("guard-what-if.mjs")) await main();
