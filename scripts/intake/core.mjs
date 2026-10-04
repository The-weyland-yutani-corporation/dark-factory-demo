import { createHash } from "node:crypto";

export function normalizeGoalKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function intakeGoal(contract, policy) {
  const required = policy.issueForms.goal.requiredFields;
  const normalized = {
    ...contract,
    goal_key: normalizeGoalKey(contract.goal_key),
  };
  const missing = required.filter((field) => {
    const value = normalized[field];
    return value === undefined || value === null || value === "";
  });
  const authorized =
    normalized.authorization?.autonomousChanges === true &&
    normalized.authorization?.dataSafe === true;
  const validKey = new RegExp(policy.idempotency.goalKeyPattern).test(
    normalized.goal_key,
  );
  const digestFields = Object.fromEntries(
    required.map((field) => [field, normalized[field]]),
  );

  return {
    accepted: missing.length === 0 && authorized && validKey,
    normalized,
    missing,
    authorized,
    validKey,
    contractDigest: createHash("sha256")
      .update(canonical(digestFields))
      .digest("hex"),
  };
}
