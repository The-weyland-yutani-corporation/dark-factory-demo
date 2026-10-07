import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWhatIf } from "./guard-what-if.mjs";
import { evaluateVerificationEvidence } from "./verify-release.mjs";

test("allows additive and incremental resource changes", () => {
  const verdict = evaluateWhatIf({
    changes: [
      { resourceId: "/create", changeType: "Create" },
      {
        resourceId: "/modify",
        changeType: "Modify",
        delta: [{ path: ".tags", propertyChangeType: "Modify" }],
      },
      { resourceId: "/same", changeType: "NoChange" },
    ],
  });
  assert.equal(verdict.allowed, true);
});

test("fails closed on deletes, unsupported changes, and malformed output", () => {
  assert.equal(
    evaluateWhatIf({
      changes: [{ resourceId: "/delete", changeType: "Delete" }],
    }).allowed,
    false,
  );
  assert.equal(
    evaluateWhatIf({
      changes: [
        {
          resourceId: "/replace",
          changeType: "Modify",
          delta: [{ path: ".sku", propertyChangeType: "Delete" }],
        },
      ],
    }).allowed,
    false,
  );
  assert.equal(evaluateWhatIf({}).allowed, false);
});

test("requires exact-SHA complete verification evidence", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(
    evaluateVerificationEvidence(
      {
        schemaVersion: 1,
        commit: sha,
        checks: [{ id: "verify", status: "passed" }],
      },
      sha,
      ["verify"],
    ),
    [],
  );
  assert.ok(
    evaluateVerificationEvidence(
      { schemaVersion: 1, commit: "b".repeat(40), checks: [] },
      sha,
      ["verify"],
    ).length >= 2,
  );
});
