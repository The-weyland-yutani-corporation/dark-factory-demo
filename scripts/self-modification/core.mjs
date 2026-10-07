import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

export function classifySurface(file, policy) {
  const matches = (prefix) => file === prefix || file.startsWith(`${prefix}/`);
  return {
    file,
    protectedSurface: policy.protectedPaths.some(matches),
    factorySurface: policy.factoryPaths.some(matches),
  };
}

export function compareEvidenceCoverage(baselineChecks, candidateChecks) {
  const baseline = new Set(baselineChecks);
  const candidate = new Set(candidateChecks);
  const removed = [...baseline].filter((item) => !candidate.has(item)).sort();
  return {
    passed: removed.length === 0,
    baseline: [...baseline].sort(),
    candidate: [...candidate].sort(),
    removed,
    added: [...candidate].filter((item) => !baseline.has(item)).sort(),
  };
}

export const CANONICAL_SCENARIOS = Object.freeze(
  [
    [
      "successful-feature",
      { kind: "feature" },
      "allow",
      ["tests", "review", "rollback"],
    ],
    [
      "failed-test-repair",
      { kind: "repair" },
      "allow",
      ["failed-test", "repair", "tests"],
    ],
    [
      "prompt-injection",
      { injectionDetected: true },
      "deny",
      ["threat-detection"],
    ],
    [
      "workflow-permission-expansion",
      { kind: "permission-expansion" },
      "deny",
      ["permission-diff"],
    ],
    [
      "failed-deployment",
      { deployment: "failed" },
      "terminal-incident",
      ["deployment-failure", "incident"],
    ],
    [
      "severe-regression-rollback",
      { kind: "regression" },
      "rollback",
      ["regression", "rollback", "incident"],
    ],
    [
      "incident-repair",
      { kind: "incident-repair" },
      "allow",
      ["incident", "regression-test", "repair"],
    ],
    [
      "budget-exhaustion",
      { budgetRemaining: 0 },
      "terminal-incident",
      ["budget", "incident"],
    ],
  ].map(([id, input, outcome, evidence]) => ({
    id,
    input,
    expected: { outcome, evidence },
  })),
);

export function replayScenario({ input }) {
  if (input.injectionDetected)
    return { outcome: "deny", evidence: ["threat-detection"] };
  if (input.kind === "permission-expansion")
    return { outcome: "deny", evidence: ["permission-diff"] };
  if (input.budgetRemaining === 0)
    return { outcome: "terminal-incident", evidence: ["budget", "incident"] };
  if (input.deployment === "failed")
    return {
      outcome: "terminal-incident",
      evidence: ["deployment-failure", "incident"],
    };
  if (input.kind === "regression")
    return {
      outcome: "rollback",
      evidence: ["regression", "rollback", "incident"],
    };
  if (input.kind === "incident-repair")
    return {
      outcome: "allow",
      evidence: ["incident", "regression-test", "repair"],
    };
  if (input.kind === "repair")
    return { outcome: "allow", evidence: ["failed-test", "repair", "tests"] };
  return { outcome: "allow", evidence: ["tests", "review", "rollback"] };
}

export function replayCanonicalScenarios() {
  return CANONICAL_SCENARIOS.map((scenario) => {
    const actual = replayScenario(scenario);
    const passed =
      actual.outcome === scenario.expected.outcome &&
      scenario.expected.evidence.every((item) =>
        actual.evidence.includes(item),
      );
    return { id: scenario.id, passed, expected: scenario.expected, actual };
  });
}

export function runCanary({
  workflowVersion,
  syntheticGoal,
  elapsedMs,
  timeoutMs,
  successful,
  ledger = new Map(),
}) {
  const operationKey = sha256(
    stableJson({ workflowVersion, syntheticGoal }),
  ).slice(0, 24);
  const existing = ledger.get(operationKey);
  if (existing) return { ...existing, idempotentReplay: true };
  const timedOut = elapsedMs > timeoutMs;
  const activated = !timedOut && successful;
  const result = {
    operationKey,
    workflowVersion,
    syntheticGoal,
    timeoutMs,
    elapsedMs,
    activated,
    reverted: !activated,
    terminalIncident: !activated,
    reason: timedOut
      ? "canary-timeout"
      : successful
        ? "synthetic-goal-passed"
        : "synthetic-goal-failed",
    idempotentReplay: false,
  };
  ledger.set(operationKey, result);
  return result;
}

export function signVerdict(unsigned) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = Buffer.from(stableJson(unsigned));
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      payloadDigest: sha256(payload),
      value: sign(null, payload, privateKey).toString("base64"),
    },
  };
}

export function verifyVerdict(verdict) {
  if (verdict?.signature?.algorithm !== "ed25519") return false;
  const { signature, ...unsigned } = verdict;
  const payload = Buffer.from(stableJson(unsigned));
  return (
    sha256(payload) === signature.payloadDigest &&
    verify(
      null,
      payload,
      signature.publicKey,
      Buffer.from(signature.value, "base64"),
    )
  );
}
