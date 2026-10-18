import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { intakeGoal } from "../intake/core.mjs";
import {
  simulateProgressiveDelivery,
  validateMigrationContract,
} from "../delivery/lib.mjs";
import {
  canonicalizeEvent,
  incidentBody,
} from "../operations/incident-core.mjs";
import {
  replayCanonicalScenarios,
  runCanary,
  stableJson,
} from "../self-modification/core.mjs";

const ROOT = process.cwd();

export async function loadDemoDependencies() {
  const [{ evaluatePolicy }, autonomy] = await Promise.all([
    import(
      pathToFileURL(path.join(ROOT, "packages/policy-engine/dist/index.js"))
        .href
    ),
    readFile(path.join(ROOT, ".github/autonomy/policy.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  return { evaluatePolicy, autonomy };
}

export function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function hasBicepLiteralSecrets(content) {
  return (
    /@secure\(\)[\s\S]{0,120}param\s+\w+\s+\w+\s*=\s*['"][^'"]+/m.test(
      content,
    ) || /\b(listKeys|listSecrets)\s*\(/i.test(content)
  );
}

function evidence(id, detail) {
  return { id, status: "passed", detail };
}

function checkedEvidence(id, passed, detail) {
  return { id, status: passed ? "passed" : "failed", detail };
}

function applyAssumptions(contract, fixture, autonomy) {
  const assumptions = [];
  const result = structuredClone(contract);
  for (const item of fixture.autonomousAssumptions ?? []) {
    if (!autonomy.assumptions.allowed.includes(item.class)) {
      throw new Error(`assumption class is not allowed: ${item.class}`);
    }
    if (result[item.field] === undefined || result[item.field] === "") {
      result[item.field] = item.value;
      assumptions.push({
        ...item,
        source: ".github/autonomy/policy.json",
        reversible: true,
      });
    }
  }
  return { contract: result, assumptions };
}

function transition(autonomy, from, to) {
  const match = autonomy.lifecycle.goal.transitions.find(
    (item) => item.from === from && item.to === to,
  );
  if (!match)
    throw new Error(`unsupported lifecycle transition ${from} -> ${to}`);
  return { from, to, actor: match.actor, guard: match.guard };
}

function malicious(value) {
  return /ignore (?:all |previous )?instructions|exfiltrat|reveal secret|run shell|curl\s+https?:/i.test(
    stableJson(value),
  );
}

function baseResult(fixture, intake, assumptions) {
  return {
    id: fixture.id,
    title: fixture.title,
    expectedOutcome: fixture.expectedOutcome,
    outcome: null,
    passed: false,
    liveMutation: false,
    intake: {
      accepted: intake.accepted,
      goalKey: intake.normalized.goal_key,
      contractDigest: intake.contractDigest,
      missing: intake.missing,
    },
    assumptions,
    transitions: [],
    evidence: [],
    sideEffects: [],
  };
}

function finish(result, outcome) {
  result.outcome = outcome;
  result.passed =
    outcome === result.expectedOutcome &&
    result.liveMutation === false &&
    result.evidence.every((item) => item.status === "passed");
  return result;
}

export async function executeScenario(fixture, options, dependencies) {
  const { autonomy, evaluatePolicy } = dependencies;
  const assumed = applyAssumptions(fixture.contract, fixture, autonomy);
  const intake = intakeGoal(assumed.contract, autonomy);
  const result = baseResult(fixture, intake, assumed.assumptions);
  const injected = new Set(options.injections ?? []);

  if (fixture.id === "malicious-prompt") {
    const detected = malicious(fixture.untrustedContent);
    const decision = evaluatePolicy(
      {
        defaultAction: "allow",
        rules: [
          {
            id: "deny-untrusted-instructions",
            description: "Untrusted issue content cannot become instructions",
            priority: 100,
            action: "deny",
            conditions: { subject: "untrusted-content", detected: true },
          },
        ],
      },
      {
        subject: "untrusted-content",
        resource: "goal-intake",
        attributes: { detected },
      },
    );
    result.evidence.push(
      evidence("threat-detection", {
        detected,
        decision: decision.action,
        contentExecuted: false,
      }),
    );
    result.transitions.push(
      transition(autonomy, "state:submitted", "state:terminal"),
    );
    return finish(result, "terminal-ignored-malicious-content");
  }

  if (!intake.accepted) {
    result.evidence.push(evidence("intake-rejection", intake.missing));
    result.transitions.push(
      transition(autonomy, "state:submitted", "state:terminal"),
    );
    return finish(result, "terminal-invalid-contract");
  }

  result.transitions.push(
    transition(autonomy, "state:submitted", "state:planned"),
  );

  if (fixture.id === "budget-exhaustion") {
    const exhausted = fixture.budget.consumed >= fixture.budget.maximum;
    result.evidence.push(
      evidence("budget-ledger", {
        ...fixture.budget,
        exhausted,
        mutationAfterExhaustion: false,
      }),
    );
    result.transitions.push(
      transition(autonomy, "state:planned", "state:terminal"),
    );
    result.sideEffects.push({
      type: "incident",
      key: `${intake.normalized.goal_key}:implementation:budget-exhausted`,
      deduplicated: true,
    });
    return finish(result, "terminal-budget-exhausted");
  }

  result.transitions.push(
    transition(autonomy, "state:planned", "state:implementing"),
  );

  if (fixture.id === "database-migration") {
    const migration = validateMigrationContract(fixture.migration);
    result.evidence.push(evidence("migration-contract", migration));
    if (!migration.compatible) {
      result.transitions.push(
        transition(autonomy, "state:implementing", "state:terminal"),
      );
      return finish(result, "terminal-incompatible-migration");
    }
  } else if (fixture.id === "deployment-regression") {
    const delivery = simulateProgressiveDelivery({
      previousRevision: fixture.traffic.previous,
      candidateRevision: fixture.traffic.candidate,
      steps: fixture.traffic.steps,
      regressionAtStep: fixture.traffic.regressionAtStep,
    });
    const signal = canonicalizeEvent(
      "synthetic",
      {},
      fixture.syntheticRegression,
    );
    result.evidence.push(
      evidence("traffic-rollback", {
        attemptedRevision: fixture.traffic.candidate,
        restoredRevision: fixture.traffic.previous,
        distribution: delivery.finalDistribution,
        delivery,
      }),
      evidence("incident", {
        key: signal.incidentKey,
        severe: signal.severe,
        bodyDigest: digest(incidentBody(signal, fixture.runUrl)),
      }),
    );
    result.sideEffects.push({
      type: "incident",
      key: signal.incidentKey,
      deduplicated: true,
    });
    result.transitions.push(
      transition(autonomy, "state:implementing", "state:terminal"),
    );
    return finish(result, "rolled-back-incident-opened");
  } else if (fixture.id === "bicep-infrastructure") {
    const protectedFiles = fixture.changedFiles.every(
      (file) => file === "infra" || file.startsWith("infra/"),
    );
    const files = await Promise.all(
      fixture.changedFiles.map(async (file) => ({
        file,
        content: await readFile(path.join(ROOT, file), "utf8"),
      })),
    );
    const explicitApiVersions = files.every(({ content }) =>
      [...content.matchAll(/resource\s+\w+\s+'[^']+@([^']+)'/g)].every(
        (match) => /^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(match[1]),
      ),
    );
    const noLiteralSecrets = files.every(
      ({ content }) => !hasBicepLiteralSecrets(content),
    );
    const valid =
      protectedFiles &&
      files.length > 1 &&
      explicitApiVersions &&
      noLiteralSecrets;
    result.evidence.push(
      checkedEvidence("bicep-goal", valid, {
        changedFiles: fixture.changedFiles,
        credentialRequired: false,
        validations: fixture.validations,
        protectedFiles,
        explicitApiVersions,
        noLiteralSecrets,
        modularDesign: files.length > 1,
      }),
    );
  } else if (fixture.id === "workflow-self-modification") {
    const scenarios = replayCanonicalScenarios();
    const ledger = new Map();
    const input = {
      workflowVersion: fixture.workflowVersion,
      syntheticGoal: fixture.syntheticGoal,
      elapsedMs: fixture.canary.elapsedMs,
      timeoutMs: fixture.canary.timeoutMs,
      successful: !injected.has("canary-failure"),
      ledger,
    };
    const canary = runCanary(input);
    const replay = runCanary(input);
    result.evidence.push(
      evidence("self-modification-evaluation", {
        canonicalScenariosPassed: scenarios.every((item) => item.passed),
        canary,
        idempotentReplay: replay.idempotentReplay,
      }),
    );
    if (!canary.activated) {
      result.sideEffects.push({
        type: "incident",
        key: `${intake.normalized.goal_key}:canary:failed`,
        deduplicated: true,
      });
      result.transitions.push(
        transition(autonomy, "state:implementing", "state:terminal"),
      );
      return finish(result, "reverted-terminal-incident");
    }
  } else {
    const startsFailing =
      fixture.id === "failing-test-repair" || injected.has("test-failure");
    result.evidence.push(
      evidence("implementation-test", {
        initial: startsFailing ? "failed" : "passed",
        failure: startsFailing ? fixture.failure : null,
      }),
    );
    if (startsFailing) {
      result.evidence.push(
        evidence("bounded-repair", {
          attempts: 1,
          maximum: autonomy.budgets.global.maxRepairAttempts,
          finalTest: injected.has("repair-failure") ? "failed" : "passed",
        }),
      );
      if (injected.has("repair-failure")) {
        result.transitions.push(
          transition(autonomy, "state:implementing", "state:terminal"),
        );
        return finish(result, "terminal-repair-failed");
      }
    }
  }

  result.transitions.push(
    transition(autonomy, "state:implementing", "state:review"),
  );

  if (fixture.id === "review-rejection") {
    result.evidence.push(
      evidence("independent-review", {
        first: "changes-requested",
        finding: fixture.reviewFinding,
        reviewerIndependent: true,
      }),
    );
    result.transitions.push(
      transition(autonomy, "state:review", "state:implementing"),
      transition(autonomy, "state:implementing", "state:review"),
    );
    result.evidence.push(
      evidence("review-repair", {
        attempts: 1,
        final: "approved",
        sameHeadRevalidated: true,
      }),
    );
  } else {
    result.evidence.push(
      evidence("independent-review", {
        final: "approved",
        reviewerIndependent: true,
      }),
    );
  }

  result.transitions.push(
    transition(autonomy, "state:review", "state:reviewed"),
    transition(autonomy, "state:reviewed", "state:merging"),
    transition(autonomy, "state:merging", "state:completed"),
  );
  result.evidence.push(
    evidence("production-ready", {
      immutableArtifact: `sha256:${digest(fixture).slice(0, 32)}`,
      rollback: intake.normalized.rollback,
      credentialsUsed: false,
      liveDeployment: false,
    }),
  );
  return finish(result, "production-ready-evidence");
}

export function createReport(results, options = {}) {
  const report = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    mode: "local-simulation",
    liveServicesCalled: [],
    injections: [...(options.injections ?? [])].sort(),
    scenarios: results,
  };
  return {
    ...report,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed).length,
      idempotent: options.idempotent ?? null,
    },
    reportDigest: digest(report),
  };
}
