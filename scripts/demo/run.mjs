import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createReport,
  digest,
  executeScenario,
  loadDemoDependencies,
} from "./core.mjs";

function parseArguments(argv) {
  const parsed = {
    scenario: null,
    output: "reports/demo/report.json",
    injections: [],
    assertIdempotent: false,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--scenario") parsed.scenario = argv[++index];
    else if (value === "--output") parsed.output = argv[++index];
    else if (value === "--inject") parsed.injections.push(argv[++index]);
    else if (value === "--assert-idempotent") parsed.assertIdempotent = true;
    else if (value === "--list") parsed.list = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  return parsed;
}

async function loadFixtures(selected) {
  const directory = path.join(process.cwd(), "scripts/demo/fixtures");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const suites = await Promise.all(
    files.map((file) =>
      readFile(path.join(directory, file), "utf8").then(JSON.parse),
    ),
  );
  const loaded = suites.flatMap((suite) =>
    suite.scenarios.map((scenario) => ({
      ...scenario,
      contract: { ...suite.goalDefaults, ...scenario.contract },
    })),
  );
  if (!selected) return loaded;
  const match = loaded.find((item) => item.id === selected);
  if (!match) throw new Error(`unknown scenario: ${selected}`);
  return [match];
}

async function execute(fixtures, options, dependencies) {
  return Promise.all(
    fixtures.map((fixture) => {
      const prefix = `${fixture.id}:`;
      const injections = options.injections
        .filter((item) => item.startsWith(prefix))
        .map((item) => item.slice(prefix.length));
      return executeScenario(fixture, { injections }, dependencies);
    }),
  );
}

const options = parseArguments(process.argv.slice(2));
const fixtures = await loadFixtures(options.scenario);
if (options.list) {
  for (const fixture of fixtures)
    console.log(`${fixture.id}\t${fixture.title}`);
  process.exit(0);
}

const dependencies = await loadDemoDependencies();
const first = await execute(fixtures, options, dependencies);
let idempotent = null;
if (options.assertIdempotent) {
  const replay = await execute(fixtures, options, dependencies);
  idempotent = digest(first) === digest(replay);
}
const report = createReport(first, {
  injections: options.injections,
  idempotent,
});
await mkdir(path.dirname(options.output), { recursive: true });
await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    report: options.output,
    digest: report.reportDigest,
    summary: report.summary,
  }),
);
if (
  report.summary.failed > 0 ||
  (options.assertIdempotent && !report.summary.idempotent)
) {
  process.exitCode = 1;
}
