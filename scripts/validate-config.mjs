import { readFile } from "node:fs/promises";

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const source = process.argv[2] ?? ".env.example";
const values = parseEnv(await readFile(source, "utf8"));
const errors = [];
const port = Number(values.API_PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  errors.push("API_PORT must be an integer between 1 and 65535");
}
if (!["true", "false"].includes(values.READINESS_ENABLED ?? "true")) {
  errors.push("READINESS_ENABLED must be true or false");
}
if (!["demo", "production"].includes(values.FACTORY_DATA_MODE ?? "demo")) {
  errors.push("FACTORY_DATA_MODE must be demo or production");
}
if (values.CORS_ORIGIN !== "false") {
  try {
    const origin = new URL(values.CORS_ORIGIN ?? "http://localhost:5173");
    if (!["http:", "https:"].includes(origin.protocol)) {
      errors.push("CORS_ORIGIN must use http or https");
    }
  } catch {
    errors.push("CORS_ORIGIN must be a valid URL or false");
  }
}

if (errors.length > 0) {
  console.error(JSON.stringify({ source, valid: false, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        source,
        valid: true,
        mode: values.FACTORY_DATA_MODE ?? "demo",
        port,
      },
      null,
      2,
    ),
  );
}
