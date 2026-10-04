import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

const sources = (await readdir(".github/workflows"))
  .filter((file) => file.endsWith(".md"))
  .sort();

if (sources.length === 0) {
  console.log(
    "No agentic workflow Markdown sources exist; synchronization is dormant.",
  );
  process.exit(0);
}

async function generatedFingerprint() {
  const outputs = (await readdir(".github/workflows"))
    .filter(
      (file) =>
        file.endsWith(".lock.yml") || file === "agentics-maintenance.yml",
    )
    .sort();
  const entries = await Promise.all(
    outputs.map(async (file) => [
      file,
      createHash("sha256")
        .update(await readFile(`.github/workflows/${file}`))
        .digest("hex"),
    ]),
  );
  return JSON.stringify(entries);
}

const before = await generatedFingerprint();

const extension = spawnSync("gh", ["aw", "--help"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (extension.status !== 0) {
  console.error(
    "Agentic workflow sources exist, but the GitHub Agentic Workflows CLI is unavailable.",
  );
  process.exit(1);
}

const compile = spawnSync("gh", ["aw", "compile"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const harden = spawnSync(
  process.execPath,
  ["scripts/fix-generated-workflows.mjs"],
  { encoding: "utf8", stdio: "inherit" },
);
if (harden.status !== 0) process.exit(harden.status ?? 1);

if (before !== (await generatedFingerprint())) {
  console.error("Compiled agentic workflow lock files are out of sync.");
  process.exit(1);
}

console.log(
  `Agentic workflow synchronization passed for ${sources.length} sources.`,
);
