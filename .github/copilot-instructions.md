# Autonomous repository instructions

- Treat `.github/autonomy/policy.json` as the machine-readable control-plane contract and validate it against `.github/autonomy/policy.schema.json`.
- Treat a goal issue's acceptance criteria and constraints as the contract.
- Normalize the goal key, calculate the contract digest, and reuse equivalent issues, pull requests, incidents, and side effects as required by the idempotency policy.
- Work from evidence: reproduce first, implement the smallest complete change, then run focused validation.
- Record every material assumption, its repository evidence, risk classification, and budget consumption. Never expand scope based on an assumption.
- Never expose secrets, weaken policy, bypass tests, or silently broaden permissions.
- Keep implementation and review independent. An implementer must not mark its own pull request reviewed.
- Every pull request must link its goal or incident, describe risk and rollback, and name evidence artifacts.
- Reconcile labels as sets and follow only declared lifecycle transitions. `autonomy:paused`, `state:terminal`, or exhausted budget forbids further mutation.
- Changes under `.github/workflows/` must preserve least privilege, bounded concurrency, idempotency, and terminal failure behavior.
- Agentic workflow source changes require successful `gh aw compile --strict --validate --no-emit`.
- If safe progress is impossible, stop mutation and create or update an incident with concrete evidence.
