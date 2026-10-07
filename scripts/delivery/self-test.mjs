import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { validateDeliveryImage, verifyEndpoint } from "./lib.mjs";

let server;
let baseUrl;
let syntheticBody;

before(async () => {
  server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/healthz") {
      response.end(JSON.stringify({ status: "ok" }));
    } else if (request.url === "/readyz") {
      response.end(JSON.stringify({ status: "ready" }));
    } else if (request.url === "/version") {
      response.end(
        JSON.stringify({ version: "verified-commit", commit: null }),
      );
    } else if (
      request.url === "/api/policies/evaluate" &&
      request.method === "POST"
    ) {
      let body = "";
      for await (const chunk of request) body += chunk;
      syntheticBody = JSON.parse(body);
      const requiredCorrelation = [
        "goalId",
        "pullRequest",
        "commitSha",
        "workflowRunId",
        "deploymentId",
        "revision",
        "traceId",
        "correlationId",
        "policyVerdict",
      ];
      if (
        requiredCorrelation.some(
          (field) => !String(syntheticBody?.correlation?.[field] ?? "").trim(),
        )
      ) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: "invalid correlation" }));
      } else {
        response.end(JSON.stringify({ decision: "deny", evaluatedRules: 0 }));
      }
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("verification checks health, readiness, version, and synthetic behavior", async () => {
  const version = await verifyEndpoint(baseUrl, {
    expectedCommit: "verified-commit",
    attempts: 1,
  });
  assert.equal(version.version, "verified-commit");
  assert.equal(syntheticBody.correlation.commitSha, "verified-commit");
});

test("verification rejects a mismatched immutable version", async () => {
  await assert.rejects(
    verifyEndpoint(baseUrl, {
      expectedCommit: "unexpected-commit",
      attempts: 1,
    }),
    /expected unexpected-commit/,
  );
});

test("delivery images are immutable, registry-scoped, and self-describing", () => {
  const commit = "a".repeat(40);
  const imageRef = `factory.azurecr.io/dark-factory@sha256:${"b".repeat(64)}`;
  assert.deepEqual(
    validateDeliveryImage({
      imageRef,
      registryServer: "factory.azurecr.io",
      imageRepository: "dark-factory",
      labels: { "org.opencontainers.image.revision": commit },
      environment: [`APP_VERSION=${commit}`, `GIT_COMMIT=${commit}`],
    }),
    { imageRef, commit },
  );
  assert.throws(
    () =>
      validateDeliveryImage({
        imageRef: `attacker.example/dark-factory@sha256:${"b".repeat(64)}`,
        registryServer: "factory.azurecr.io",
        imageRepository: "dark-factory",
        labels: { "org.opencontainers.image.revision": commit },
        environment: [`APP_VERSION=${commit}`, `GIT_COMMIT=${commit}`],
      }),
    /must use factory\.azurecr\.io/,
  );
});

test("production resolves provenance instead of accepting a commit override", async () => {
  const production = await readFile(".github/workflows/production.yml", "utf8");
  const delivery = await readFile(".github/workflows/delivery.yml", "utf8");

  assert.doesNotMatch(production, /^\s+commit_sha:/m);
  assert.match(production, /gh attestation verify/);
  assert.match(production, /--signer-workflow/);
  assert.match(production, /node scripts\/delivery\/resolve-image\.mjs/);
  assert.match(delivery, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.doesNotMatch(delivery, /^\s+workflow_dispatch:/m);
});
