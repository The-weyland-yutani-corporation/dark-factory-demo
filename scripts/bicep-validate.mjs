import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const candidates =
  process.platform === "win32"
    ? [
        process.env.BICEP_PATH,
        path.join(homedir(), ".azure", "bin", "bicep.exe"),
        "bicep.exe",
      ]
    : [
        process.env.BICEP_PATH,
        path.join(homedir(), ".azure", "bin", "bicep"),
        "bicep",
      ];

const compiler = candidates.find(
  (candidate) =>
    candidate &&
    (candidate === "bicep" ||
      candidate === "bicep.exe" ||
      existsSync(candidate)),
);

if (!compiler) {
  console.error(
    "Bicep compiler is not present. This check intentionally does not install tooling.",
  );
  process.exit(1);
}

await mkdir("reports/bicep", { recursive: true });
const result = spawnSync(
  compiler,
  ["build", "infra/main.bicep", "--outfile", "reports/bicep/main.json"],
  { encoding: "utf8", stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
