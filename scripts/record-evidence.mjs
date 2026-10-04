import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const [id, separator, ...command] = process.argv.slice(2);

if (!id || separator !== "--" || command.length === 0) {
  console.error(
    "Usage: node scripts/record-evidence.mjs <id> -- <command> [args]",
  );
  process.exit(2);
}

const windowsNpm = process.platform === "win32" && command[0] === "npm";
const executable = windowsNpm ? process.env.ComSpec : command[0];
const args = windowsNpm
  ? ["/d", "/s", "/c", command.join(" ")]
  : command.slice(1);
const child = spawn(executable, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: "inherit",
});

const exitCode = await new Promise((resolve) => {
  child.on("error", () => resolve(1));
  child.on("exit", (code) => resolve(code ?? 1));
});

await mkdir(".evidence/checks", { recursive: true });
await writeFile(
  `.evidence/checks/${id}.json`,
  `${JSON.stringify(
    {
      id,
      status: exitCode === 0 ? "passed" : "failed",
      command: command.join(" "),
      exitCode,
    },
    null,
    2,
  )}\n`,
);

process.exitCode = exitCode;
