import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createReport,
  digest,
  executeScenario,
  hasBicepLiteralSecrets,
  loadDemoDependencies,
} from "./core.mjs";
import {
  simulateProgressiveDelivery,
  validateMigrationContract,
} from "../delivery/lib.mjs";

const suite = JSON.parse(
  await readFile("scripts/demo/fixtures/scenarios.json", "utf8"),
);
const fixtures = suite.scenarios.map((scenario) => ({
  ...scenario,
  contract: { ...suite.goalDefaults, ...scenario.contract },
}));
const dependencies = await loadDemoDependencies();

test("Bicep demo permits disabled empty inputs but rejects literal secrets and key access", () => {
  assert.equal(
    hasBicepLiteralSecrets("@secure()\nparam key string = ''"),
    false,
  );
  assert.equal(hasBicepLiteralSecrets("@secure()\nparam key string"), false);
  assert.equal(
    hasBicepLiteralSecrets("@secure()\nparam key string = 'unsafe-example'"),
    true,
  );
  assert.equal(hasBicepLiteralSecrets("var key = listKeys(resourceId)"), true);
  assert.equal(
    hasBicepLiteralSecrets("var key = listSecrets(resourceId)"),
    true,
  );
});

test("all local demonstrations reach their declared outcomes", async () => {
  const results = await Promise.all(
    fixtures.map((fixture) =>
      executeScenario(fixture, { injections: [] }, dependencies),
    ),
  );
  assert.equal(results.length, 10);
  assert.ok(results.every((result) => result.passed));
  assert.ok(results.every((result) => result.liveMutation === false));
  assert.deepEqual(createReport(results).liveServicesCalled, []);
  assert.ok(
    results
      .flatMap((result) => result.sideEffects)
      .every((sideEffect) => sideEffect.deduplicated === true),
  );
});

test("scenario replay is deterministic and idempotent", async () => {
  const fixture = fixtures.find((item) => item.id === "normal-feature");
  const first = await executeScenario(
    fixture,
    { injections: [] },
    dependencies,
  );
  const replay = await executeScenario(
    fixture,
    { injections: [] },
    dependencies,
  );
  assert.equal(digest(first), digest(replay));
});

test("failure injection terminates bounded repair safely", async () => {
  const fixture = fixtures.find((item) => item.id === "failing-test-repair");
  const result = await executeScenario(
    fixture,
    { injections: ["repair-failure"] },
    dependencies,
  );
  assert.equal(result.outcome, "terminal-repair-failed");
  assert.equal(result.passed, false);
  assert.equal(result.liveMutation, false);
  assert.equal(result.transitions.at(-1).to, "state:terminal");
});

test("delivery helpers roll back traffic and validate migration", () => {
  const delivery = simulateProgressiveDelivery({
    previousRevision: "stable",
    candidateRevision: "candidate",
    steps: [5, 25, 100],
    regressionAtStep: 25,
  });
  assert.equal(delivery.rollbackApplied, true);
  assert.deepEqual(delivery.finalDistribution, { stable: 100, candidate: 0 });
  assert.equal(
    validateMigrationContract({
      expandPhase: { oldRevisionReads: true, newRevisionReads: true },
      retrySafe: true,
      rollback: { applicationOnly: true, schemaRemainsCompatible: true },
    }).compatible,
    true,
  );
});

test("malicious content is denied by the real policy engine", async () => {
  const fixture = fixtures.find((item) => item.id === "malicious-prompt");
  const result = await executeScenario(
    fixture,
    { injections: [] },
    dependencies,
  );
  const threat = result.evidence.find((item) => item.id === "threat-detection");
  assert.equal(threat.detail.detected, true);
  assert.equal(threat.detail.decision, "deny");
  assert.equal(threat.detail.contentExecuted, false);
});

test("self-modification canary failure reverts and records an incident", async () => {
  const fixture = fixtures.find(
    (item) => item.id === "workflow-self-modification",
  );
  const result = await executeScenario(
    fixture,
    { injections: ["canary-failure"] },
    dependencies,
  );
  assert.equal(result.outcome, "reverted-terminal-incident");
  assert.equal(result.passed, false);
  assert.equal(result.sideEffects[0].deduplicated, true);
});
