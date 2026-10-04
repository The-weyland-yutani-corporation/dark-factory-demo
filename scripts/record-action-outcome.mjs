import { mkdir, writeFile } from "node:fs/promises";

const [id, outcome, command] = process.argv.slice(2);
if (!id || !outcome || !command) {
  console.error(
    "Usage: node scripts/record-action-outcome.mjs <id> <outcome> <command>",
  );
  process.exit(2);
}

const passed = outcome === "success";
await mkdir(".evidence/checks", { recursive: true });
await writeFile(
  `.evidence/checks/${id}.json`,
  `${JSON.stringify(
    {
      id,
      status: passed ? "passed" : "failed",
      command,
      exitCode: passed ? 0 : 1,
    },
    null,
    2,
  )}\n`,
);
