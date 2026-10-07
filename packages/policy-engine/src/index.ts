import type {
  PolicyAction,
  PolicyContext,
  PolicyDecision,
  PolicyRule,
} from "@dark-factory/contracts";
import { createHash, verify } from "node:crypto";

export interface PolicySet {
  readonly rules: readonly PolicyRule[];
  readonly defaultAction: PolicyAction;
}

export interface IntegrationCheck {
  readonly id?: number;
  readonly name: string;
  readonly status: "completed" | "in_progress" | "queued";
  readonly conclusion:
    | "success"
    | "failure"
    | "cancelled"
    | "timed_out"
    | "action_required"
    | "neutral"
    | "skipped"
    | null;
  readonly completedAt?: string | null;
}

export interface IntegrationReview {
  readonly author: string;
  readonly state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  readonly commitId: string;
  readonly submittedAt?: string;
}

export interface IntegrationEvidenceCheck {
  readonly id: string;
  readonly status: string;
}

export interface IntegrationEvidenceManifest {
  readonly schemaVersion: number;
  readonly commit: string;
  readonly checks: readonly IntegrationEvidenceCheck[];
}

export interface IntegrationPolicy {
  readonly requiredChecks: readonly string[];
  readonly requiredEvidenceChecks: readonly string[];
  readonly reviewedStateLabel: string;
  readonly blockingLabels: readonly string[];
  readonly selfModificationPaths: readonly string[];
  readonly selfModificationApprovalLabel: string;
  readonly selfModificationVerdictRequired: boolean;
  readonly deploymentPaths: readonly string[];
  readonly deploymentCompatibilityLabel: string;
  readonly deploymentIncompatibilityLabel: string;
}

export interface SelfModificationVerdict {
  readonly schemaVersion: number;
  readonly candidateSha: string;
  readonly isolatedWorkspace: { readonly liveSettingsMutated: boolean };
  readonly evidenceCoverage: { readonly passed: boolean };
  readonly scenarios: readonly { readonly passed: boolean }[];
  readonly toolChecks: readonly {
    readonly required: boolean;
    readonly passed: boolean;
  }[];
  readonly canary: {
    readonly activated: boolean;
    readonly reverted: boolean;
    readonly terminalIncident: boolean;
  };
  readonly decision: { readonly allowed: boolean };
  readonly signature: {
    readonly algorithm: string;
    readonly publicKey: string;
    readonly payloadDigest: string;
    readonly value: string;
  };
}

export interface IntegrationCandidate {
  readonly headSha: string;
  readonly author: string;
  readonly labels: readonly string[];
  readonly goalLabels: readonly string[];
  readonly changedFiles: readonly string[];
  readonly checks: readonly IntegrationCheck[];
  readonly reviews: readonly IntegrationReview[];
  readonly evidence: IntegrationEvidenceManifest;
  readonly selfModificationVerdict?: SelfModificationVerdict;
}

export interface IntegrationDecision {
  readonly allowed: boolean;
  readonly headSha: string;
  readonly reasons: readonly string[];
  readonly independentReviewer: string | null;
  readonly selfModification: boolean;
  readonly deploymentChange: boolean;
}

function matches(rule: PolicyRule, context: PolicyContext): boolean {
  return Object.entries(rule.conditions).every(([key, expected]) => {
    if (key === "subject") {
      return context.subject === expected;
    }
    if (key === "resource") {
      return context.resource === expected;
    }
    return context.attributes[key] === expected;
  });
}

function compareRules(left: PolicyRule, right: PolicyRule): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function evaluatePolicy(
  policySet: PolicySet,
  context: PolicyContext,
): PolicyDecision {
  const matchingRule = [...policySet.rules]
    .sort(compareRules)
    .find((rule) => matches(rule, context));

  if (matchingRule) {
    return {
      action: matchingRule.action,
      matchedRuleId: matchingRule.id,
      reason: matchingRule.description,
    };
  }

  return {
    action: policySet.defaultAction,
    matchedRuleId: null,
    reason: `No rule matched; applied default ${policySet.defaultAction} action`,
  };
}

function touchesPath(files: readonly string[], prefixes: readonly string[]) {
  return files.some((file) =>
    prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function verifySelfModificationVerdict(
  verdict: SelfModificationVerdict | undefined,
  headSha: string,
): boolean {
  if (
    !verdict ||
    verdict.schemaVersion !== 1 ||
    verdict.candidateSha !== headSha
  )
    return false;
  if (verdict.signature.algorithm !== "ed25519") return false;
  const { signature, ...unsigned } = verdict;
  const payload = Buffer.from(stableJson(unsigned));
  const digest = createHash("sha256").update(payload).digest("hex");
  if (digest !== signature.payloadDigest) return false;
  return verify(
    null,
    payload,
    signature.publicKey,
    Buffer.from(signature.value, "base64"),
  );
}

export function evaluateIntegrationGate(
  policy: IntegrationPolicy,
  candidate: IntegrationCandidate,
): IntegrationDecision {
  const reasons: string[] = [];
  const labels = new Set([...candidate.labels, ...candidate.goalLabels]);
  const checks = new Map<string, IntegrationCheck>();
  for (const check of candidate.checks) {
    const current = checks.get(check.name);
    if (
      !current ||
      (check.id ?? 0) > (current.id ?? 0) ||
      ((check.id ?? 0) === (current.id ?? 0) &&
        (check.completedAt ?? "") >= (current.completedAt ?? ""))
    ) {
      checks.set(check.name, check);
    }
  }
  const evidenceChecks = new Map(
    candidate.evidence.checks.map((check) => [check.id, check.status]),
  );
  const selfModification = touchesPath(
    candidate.changedFiles,
    policy.selfModificationPaths,
  );
  const deploymentChange = touchesPath(
    candidate.changedFiles,
    policy.deploymentPaths,
  );

  if (candidate.evidence.schemaVersion !== 1) {
    reasons.push("unsupported evidence manifest schema");
  }
  if (candidate.evidence.commit !== candidate.headSha) {
    reasons.push("evidence manifest is stale for the pull request head");
  }

  for (const required of policy.requiredEvidenceChecks) {
    const status = evidenceChecks.get(required);
    if (status !== "passed") {
      reasons.push(
        status
          ? `required evidence check ${required} is ${status}`
          : `required evidence check ${required} is missing`,
      );
    }
  }

  for (const required of policy.requiredChecks) {
    const check = checks.get(required);
    if (
      !check ||
      check.status !== "completed" ||
      check.conclusion !== "success"
    ) {
      reasons.push(`required GitHub check ${required} has not passed`);
    }
  }

  if (!candidate.goalLabels.includes(policy.reviewedStateLabel)) {
    reasons.push(`goal is not in ${policy.reviewedStateLabel}`);
  }
  for (const label of policy.blockingLabels) {
    if (labels.has(label)) reasons.push(`blocking label is present: ${label}`);
  }

  const latestReviews = new Map<string, IntegrationReview>();
  for (const review of candidate.reviews) {
    const current = latestReviews.get(review.author.toLowerCase());
    if (!current || (review.submittedAt ?? "") >= (current.submittedAt ?? "")) {
      latestReviews.set(review.author.toLowerCase(), review);
    }
  }
  const independentApproval = [...latestReviews.values()].find(
    (review) =>
      review.state === "APPROVED" &&
      review.commitId === candidate.headSha &&
      review.author.toLowerCase() !== candidate.author.toLowerCase(),
  );
  if (!independentApproval) {
    reasons.push("independent approval for the current head is missing");
  }

  if (selfModification && policy.selfModificationVerdictRequired) {
    const verdict = candidate.selfModificationVerdict;
    if (!verifySelfModificationVerdict(verdict, candidate.headSha)) {
      reasons.push("signed self-modification verdict is missing or invalid");
    } else {
      const verifiedVerdict = verdict!;
      if (!verifiedVerdict.decision.allowed)
        reasons.push("self-modification verdict denied the candidate");
      if (verifiedVerdict.isolatedWorkspace.liveSettingsMutated)
        reasons.push("self-modification evaluation mutated live settings");
      if (!verifiedVerdict.evidenceCoverage.passed)
        reasons.push("self-modification reduced evidence coverage");
      if (verifiedVerdict.scenarios.some((scenario) => !scenario.passed))
        reasons.push("self-modification canonical scenario failed");
      if (
        verifiedVerdict.toolChecks.some(
          (check) => check.required && !check.passed,
        )
      )
        reasons.push("self-modification tool validation failed");
      if (
        !verifiedVerdict.canary.activated ||
        verifiedVerdict.canary.reverted ||
        verifiedVerdict.canary.terminalIncident
      )
        reasons.push("self-modification canary did not activate safely");
    }
  }

  if (labels.has(policy.deploymentIncompatibilityLabel)) {
    reasons.push("deployment is marked incompatible");
  } else if (
    deploymentChange &&
    !labels.has(policy.deploymentCompatibilityLabel)
  ) {
    reasons.push("deployment compatibility evaluation is missing");
  }

  return {
    allowed: reasons.length === 0,
    headSha: candidate.headSha,
    reasons,
    independentReviewer: independentApproval?.author ?? null,
    selfModification,
    deploymentChange,
  };
}
