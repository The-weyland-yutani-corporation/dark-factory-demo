import { execFileSync } from "node:child_process";
import { copyFile, stat } from "node:fs/promises";

const apply = process.argv.includes("--apply");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) throw new Error("Node.js 22 or newer is required");

let envExists = true;
try {
  await stat(".env");
} catch {
  envExists = false;
}

execFileSync(
  process.execPath,
  ["scripts/validate-config.mjs", ".env.example"],
  {
    stdio: "inherit",
  },
);
execFileSync(process.execPath, ["scripts/validate-agentic-credentials.mjs"], {
  stdio: "inherit",
});

if (!apply) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        actions: [
          envExists ? "preserve existing .env" : "copy .env.example to .env",
          "run npm ci",
          "run npm run build",
        ],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!envExists) await copyFile(".env.example", ".env");
execFileSync("npm", ["ci"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
execFileSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log("Bootstrap complete; existing .env content was not overwritten.");
