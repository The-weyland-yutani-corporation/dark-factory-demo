# Autonomous goal contract

`policy.json` is the machine-readable source of truth for goal intake, lifecycle transitions, assumptions, budgets, deduplication, idempotency, and evidence. `policy.schema.json` defines its structural contract. `.github/labels.yml` is the canonical label catalog.

## Reconciliation rules

1. Validate a goal form and normalize its goal key before mutation.
2. Reconcile exactly one label from each applicable exclusive group; never toggle labels.
3. Follow only lifecycle transitions declared in `policy.json` and satisfy the named guard.
4. Reserve and account for the strictest applicable budget: global, risk profile, goal-selected profile, or repository constraint.
5. Reuse equivalent issues, pull requests, incidents, comments, and side effects by operation key.
6. Stop mutation on policy conflict, unsafe uncertainty, pause, or exhaustion; preserve evidence and reconcile a single incident.
7. Enqueue integration only from the default-branch workflow after the exact head SHA's evidence manifest, required checks, independent approval, lifecycle labels, self-modification safety, and deployment compatibility pass.
8. Reconcile `state:merging` after queue admission and `state:completed` only from the merged pull request event carrying `integration:ready`.

Labels describe current state; comments and linked check artifacts preserve transition history. A retry must first read that history and recorded operation keys rather than infer completion from labels alone.

Implementation and repair remain inside the App-authenticated gh-aw safe-output
boundary. Initial implementation writes code and emits one
`create-pull-request`; bounded repair emits one
`push-to-pull-request-branch` for the reconciled matching pull request. Both use
Dark Factory Mage installation tokens, App-authenticated CI-trigger commits,
protected-file review policy, deterministic operation keys, and the independent
review workflow. User PATs and `assign-to-agent` are forbidden.

## Live repository reconciliation

`ruleset.json` and `repository-settings.json` are reviewed configuration artifacts. `npm run reconcile:github` is dry-run only. Applying them requires both `--apply` and `CONFIRM_GITHUB_RECONCILE=owner/repo`; the script reconciles labels, repository merge settings, and the named ruleset idempotently through `gh api`. Local verification never uses `--apply`.
