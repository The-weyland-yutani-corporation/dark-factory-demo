import { appendFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

export function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return (result.stdout ?? "").trim();
}

export function azJson(args) {
  const output = run("az", [...args, "--output", "json"]);
  return output ? JSON.parse(output) : null;
}

export function azTsv(args) {
  return run("az", [...args, "--output", "tsv"]);
}

export async function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  } else {
    console.log(`${name}=${value}`);
  }
}

export async function writeState(state) {
  await writeFile(
    ".delivery-state.json",
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export function validateMigrationContract(migration) {
  const compatible = Boolean(
    migration?.expandPhase?.oldRevisionReads &&
    migration?.expandPhase?.newRevisionReads &&
    migration?.retrySafe &&
    migration?.rollback?.applicationOnly &&
    migration?.rollback?.schemaRemainsCompatible,
  );
  return {
    compatible,
    retrySafe: migration?.retrySafe === true,
    destructiveRollback: migration?.rollback?.applicationOnly !== true,
    phases: ["expand", "deploy", "contract-later"],
  };
}

export function simulateProgressiveDelivery({
  previousRevision,
  candidateRevision,
  steps,
  regressionAtStep,
}) {
  const events = [];
  for (const candidateWeight of steps) {
    const distribution = {
      [previousRevision]: 100 - candidateWeight,
      [candidateRevision]: candidateWeight,
    };
    events.push({ type: "traffic-shift", candidateWeight, distribution });
    if (candidateWeight === regressionAtStep) {
      const rollback = { [previousRevision]: 100, [candidateRevision]: 0 };
      events.push({ type: "traffic-rollback", distribution: rollback });
      return {
        completed: false,
        regressionDetected: true,
        rollbackApplied: true,
        finalDistribution: rollback,
        events,
      };
    }
  }
  return {
    completed: true,
    regressionDetected: false,
    rollbackApplied: false,
    finalDistribution: { [previousRevision]: 0, [candidateRevision]: 100 },
    events,
  };
}

export function deliveryProbeRequest(expectedCommit = "delivery-probe") {
  return {
    defaultAction: "deny",
    context: {
      subject: "delivery-probe",
      resource: "production",
      attributes: { source: "github-actions" },
    },
    rules: [],
    correlation: {
      goalId: "delivery-verification",
      pullRequest: "none",
      commitSha: expectedCommit,
      workflowRunId: process.env.GITHUB_RUN_ID ?? "local",
      deploymentId: process.env.DEPLOYMENT_ID ?? "pre-deployment",
      revision: process.env.REVISION_NAME ?? "candidate",
      traceId: `delivery-${expectedCommit}`,
      correlationId: `delivery-${expectedCommit}`,
      policyVerdict: "pending",
    },
  };
}

export function validateDeliveryImageReference({
  imageRef,
  registryServer,
  imageRepository,
}) {
  const prefix = `${registryServer}/${imageRepository}@sha256:`;
  if (
    !imageRef.startsWith(prefix) ||
    !/^[a-f0-9]{64}$/i.test(imageRef.slice(prefix.length))
  ) {
    throw new Error(`IMAGE_REF must use ${prefix}<64 hex chars>`);
  }
  return imageRef;
}

export function validateDeliveryImage({
  imageRef,
  registryServer,
  imageRepository,
  labels,
  environment,
}) {
  validateDeliveryImageReference({
    imageRef,
    registryServer,
    imageRepository,
  });
  const commit = labels?.["org.opencontainers.image.revision"];
  if (!/^[a-f0-9]{40}$/i.test(commit ?? "")) {
    throw new Error(
      "Image revision label must contain a 40-character Git commit SHA",
    );
  }
  const embedded = Object.fromEntries(
    (environment ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return separator < 0
        ? [entry, ""]
        : [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  if (embedded.GIT_COMMIT !== commit || embedded.APP_VERSION !== commit) {
    throw new Error(
      "Image version environment does not match its revision label",
    );
  }
  return { imageRef, commit };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${url}: ${response.status} ${body}`,
    );
  }
  return body ? JSON.parse(body) : null;
}

export async function verifyEndpoint(
  baseUrl,
  { expectedCommit, attempts = 12, synthetic = true } = {},
) {
  const normalized = baseUrl.replace(/\/$/, "");
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = await requestJson(`${normalized}/healthz`);
      if (health?.status !== "ok") throw new Error("health status is not ok");

      const readiness = await requestJson(`${normalized}/readyz`);
      if (readiness?.status !== "ready") {
        throw new Error("readiness status is not ready");
      }

      const version = await requestJson(`${normalized}/version`);
      if (
        expectedCommit &&
        version?.commit !== expectedCommit &&
        version?.version !== expectedCommit
      ) {
        throw new Error(
          `expected ${expectedCommit}, received ${version?.commit ?? version?.version}`,
        );
      }

      if (synthetic) {
        const evaluation = await requestJson(
          `${normalized}/api/policies/evaluate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(deliveryProbeRequest(expectedCommit)),
          },
        );
        if (evaluation?.decision !== "deny") {
          throw new Error(
            "synthetic policy evaluation returned an unsafe result",
          );
        }
      }
      return version;
    } catch (error) {
      lastError = error;
      console.warn(
        `Verification attempt ${attempt}/${attempts}: ${error.message}`,
      );
      if (attempt < attempts) await delay(5_000);
    }
  }
  throw lastError;
}

export async function observe(baseUrl, seconds, expectedCommit) {
  const deadline = Date.now() + seconds * 1_000;
  do {
    await verifyEndpoint(baseUrl, {
      expectedCommit,
      attempts: 1,
      synthetic: true,
    });
    if (Date.now() < deadline)
      await delay(Math.min(10_000, deadline - Date.now()));
  } while (Date.now() < deadline);
}
