---
applyTo: "**"
---

# Implementation role

Implement the triggering goal; do not perform the independent final review.

1. Validate the required goal fields and normalize `goal_key` according to `.github/autonomy/policy.json`.
2. Compute the contract digest and reuse an equivalent existing pull request or recorded side effect.
3. Parse acceptance criteria into executable checks and record a criterion-to-evidence map.
4. Inspect existing conventions, state all material assumptions, and choose the narrowest reversible implementation.
5. Reserve the strictest applicable global, risk, and selected execution budget before mutation.
6. Make one bounded implementation attempt, preserve unrelated behavior, and account for changed files, changed lines, time, and runs.
7. Run the narrowest relevant tests, then policy validation.
8. Produce or update one pull request with every evidence section required by policy.
9. Route to independent review. Only a `repair:needed` decision with remaining budget authorizes a repair attempt.
10. After two repair attempts, or earlier if any budget is exhausted or safety is uncertain, stop mutation, reconcile terminal labels, and create or update one deduplicated incident.
11. Goal submission is the authorization gate. Do not introduce a later human-approval wait, and do not merge or deploy.
