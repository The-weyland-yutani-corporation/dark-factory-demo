# Operations runbook

## Accelerator readiness

**Dark Factory Control Room — Governed Autonomous Software Delivery** targets
platform engineering leads in reusable, cross-industry engagements. The desired
state is catalog-ready; the current state remains **demo candidate**, not a
Microsoft certification. See `accelerator.yaml` for deliberately unvalidated
submission metadata.

Three publication priorities: prove the local presenter path; resolve portability,
licensing and support ownership; package customer narrative, accessible media,
and catalog-compatible metadata. The catalog URL currently redirects to Microsoft
enterprise SSO; its API returned 404 in this environment. Schema/taxonomy
validation requires authorized catalog access and is not claimed.

### Customer journey and engagement

Customer request: “Automate a low-risk service change with evidence and recovery.”

1. **Input:** write the outcome, acceptance criteria, constraints, authorization,
   risk, budget and rollback in the existing goal issue form.
2. **Context:** validate policy, normalize the goal key, hash its contract, and
   search for equivalent work before creating side effects.
3. **Plan:** map criteria to executable evidence and reserve the strictest budget.
4. **Change:** implement one bounded attempt; produce a PR and commit-bound checks.
5. **Review:** an independent reviewer checks evidence; only authorized bounded
   repairs proceed. Unsafe/exhausted work stops with an incident.
6. **Deliver:** configured live workflows use attested images, progressive traffic
   exposure and recovery checks.
7. **Observe:** correlate failures; restore the prior revision or create one
   bounded fix-forward goal.
8. **Outcome/next action:** review evidence against a baseline and select the next
   reversible pilot workload.

Local scenarios **simulate** external effects. They do not create real issues,
PRs, deployments, or dashboard updates. Dashboard metrics/costs are synthetic;
live health checks alone do not establish production readiness.

**Account-team opener:** Where could your teams remove delivery handoffs while
retaining evidence, authorization boundaries, and a tested recovery path?

**Discovery:** Which changes wait on coordination? What evidence must pass?
What actions are authorized or prohibited? What are baseline lead time,
manual touches, failure rate and recovery time? Which GitHub/Azure, identity,
network and compliance constraints apply? Who owns recovery? Which reversible
non-production workload is suitable?

**Workshop/pilot:** map one journey with a repository owner and security/operations
representative. Define authorization, acceptance checks, evidence, budget and
rollback first; start offline, then activate only the agreed non-production
integrations. Avoid factory self-modification as the first pilot. Deliver an
adapted architecture, permission matrix, tests, recovery evidence and outcome report.

**Success:** every criterion has executable proof; mutations trace to their goal
and revision; retries create no duplicates; unsafe/exhausted work stops; a recovery
exercise restores the expected revision; lead time/manual touches are compared
with measured baselines; permissions remain within scope.

**CTA:** bring one low-risk request and its owners; agree thresholds before
enabling live automation. No customer savings or performance improvement is promised.

## Presenter guide

### Setup, expected results, and reset

Run bootstrap below, then `npm run demo:list` to list all **ten** scenarios.
Keep the built API running on port 3000. For UI development, start the API and
`npm run dev:web` in separate terminals; open port 5173. The worker is optional.
Export overrides such as `FACTORY_DATA_MODE=demo` in your shell; `.env` is
preserved by bootstrap but is not automatically loaded by the runtime.

Run each command from the repository root:

```sh
npm run demo -- --scenario normal-feature --output reports/demo/feature.json
npm run demo -- --scenario failing-test-repair --output reports/demo/repair.json
npm run demo -- --scenario deployment-regression --output reports/demo/rollback.json
npm run demo -- --scenario malicious-prompt --output reports/demo/rejection.json
npm run demo -- --scenario budget-exhaustion --output reports/demo/budget.json
```

Expected: each summary has `failed: 0` and `idempotent: true`.
Inspect `scenarios[].outcome`, `evidence`, and simulated `sideEffects`:
feature/repair → `production-ready-evidence` (a simulation label, not certification);
regression → `rolled-back-incident-opened`; malicious input →
`terminal-ignored-malicious-content`; budget → `terminal-budget-exhausted`.
No service is contacted or changed.

Reset by rerunning the same command: reports are overwritten and execution uses
fresh simulated state. Refresh restores the fixed dashboard records; it does not
load scenario reports. Stop the local API with Ctrl+C. Do not invoke GitHub
reconciliation or Azure deployment during this walkthrough.

### Five-minute flow

| Time      | Action and narration                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Introduce a platform team's slow delivery handoffs; faster delivery needs visible boundaries. |
| 0:45–1:45 | Open the dashboard; read the synthetic-data disclosure, show posture and audit correlation.   |
| 1:45–2:45 | Run `normal-feature`; show the contract, checks and simulated outcome in its report.          |
| 2:45–4:00 | Run `deployment-regression`; show restored traffic and the deduplicated incident.             |
| 4:00–5:00 | Show architecture; agree one low-risk pilot and measurable acceptance criteria.               |

### Fifteen-minute flow

| Time      | Action and narration                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| 0–2 min   | Customer challenge and explicit simulation/live boundaries.                           |
| 2–4 min   | Goal form: outcome, constraints, risk, evidence, rollback and budget.                 |
| 4–6 min   | Dashboard: synthetic metrics, estimated costs, operations and expanded lineage.       |
| 6–9 min   | Run feature and repair commands; inspect evidence and bounded retry behavior.         |
| 9–11 min  | Run malicious-input and budget scenarios; show safe terminal outcomes.                |
| 11–13 min | Run rollback scenario; contrast simulation with separately configured Azure delivery. |
| 13–15 min | Review integration/permission gaps, pilot baseline and next-step agreement.           |

**Fallback:** if execution fails, show previously captured assets with their source
revision and limitations, or use architecture plus scenario fixtures as an explicitly
non-executed explanation. Never claim a failed or recorded run is live success.

### Reuse and live activation boundaries

| Reuse                                        | Customize or review                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Goal forms, deduplication, bounded lifecycle | Authorized actions, customer risk and acceptance tests                  |
| TypeScript contracts and React UI            | Branding, access control and production operations adapter              |
| Ten deterministic scenarios                  | Synthetic customer request, measures, local evidence                    |
| Verification and audit patterns              | Workload tests, policy thresholds, retention requirements               |
| OIDC, immutable image and rollback patterns  | Subscription, App installation, networking, runners, recovery ownership |

Keep a reusable submission free of operator identities and customer/internal links.
**The checked-in `infra/main.demo*.bicepparam`, `.azure` evidence and live deployment
documentation remain the original environment's baseline.** They are not generic
customer defaults. Do not copy or deploy them unchanged. The infrastructure guide
explains how to supply an external customer parameter file without altering that
tested baseline. History is not anonymized by changing current files.

The alert dispatcher now requires explicit `GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID`, `GITHUB_REPOSITORY_OWNER`, and
`GITHUB_REPOSITORY_NAME`; missing/blank values fail before Key Vault/network access.
Existing Bicep settings still explicitly target this demonstration; adaptation
must replace those settings before activation. No credentials belong in examples.

| Identity / operation              | Scope and boundary                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Local preview / offline scenarios | No GitHub/Azure credential required                                                       |
| Delivery OIDC identity            | Registry-scoped AcrPush; Container App/job-scoped contributor                             |
| Infrastructure identity           | Resource-group deployment and required role-assignment rights                             |
| Agentic GitHub App                | Repository-limited safe-output permissions listed below; reasoning never receives the key |
| Alert bridge identity/App         | Vault/storage roles below; repository dispatch needs Contents write                       |
| Settings reconciliation           | Separate operator credential; never run by local validation                               |

Review ingress/authentication before hosting: the API's policy preview accepts
caller-supplied rules; it is **not** a protected production authorization service.
CORS is not authentication. Review logs, screenshots and reports for secrets and
personal data; do not publish real customer telemetry.

**Cost drivers:** GitHub/Copilot entitlements and agent runs; connected runners;
Premium ACR; Container Apps workload profiles; PostgreSQL compute/storage; private
endpoints, Functions/storage, Key Vault, monitoring ingestion and retention.
Local synthetic cost totals are not a quote. Use current regional pricing and a
customer baseline; inventory resources and use teardown planning after a pilot.

### Support, contribution, and publication gates

Use issues only for sanitized questions with revision, Node/npm versions, command,
expected/actual result and redacted logs. No SLA or dedicated support owner is
established. For vulnerabilities, use private GitHub reporting only when enabled;
otherwise obtain a private maintainer contact before sharing details.
Do not assume public-source access grants redistribution rights: an owner-approved
license and third-party attribution review remain required.

To contribute an adaptation: use synthetic examples, document differences and
rollback, map acceptance criteria to checks, preserve independent review and policy,
and supply sanitized exact-revision evidence. Catalog contribution requires its
authorized schema/taxonomy checks; this repository cannot attest to acceptance.

| Gate          | Required evidence / current status                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo-ready    | Tested bootstrap, all scenarios/idempotency, explicit disclosure, accessible captures and scripts; see validation record below                      |
| Field-ready   | Independent second-presenter replay, portable live configuration, privacy/security review, license, owner, permissions/cost guidance; still blocked |
| Catalog-ready | Authorized schema validation, accepted taxonomy, media/links, license/support ownership and recorded limitations; still blocked                     |

Preparation checklist: README/story and journey; architecture/alt text; timed script;
setup/reset; deployment/rollback/cleanup; sample data and measures; screenshots,
captions/transcript; security/privacy scrub; Copilot adaptation instructions;
exact-head Actions/least privilege; support/license; catalog metadata.

### Implementation assumptions and evidence

This user-requested packaging pass does not activate the autonomous goal lifecycle,
merge, deploy, or approve its own work. No triggering goal issue was provided;
no issue contract digest or lifecycle attestation is fabricated.
Material assumptions are conservative: cross-industry audience and catalog target
come from the request; retain the tested live baseline (`tests/iac-parameters.test.ts`);
use synthetic scenarios (`scripts/demo/fixtures/scenarios.json`); never grant a
license or invent a support owner. Risk: low, reversible local/UI/configuration
changes only; no permissions or workflows changed.

Budget reserved before mutation: one implementation attempt, at most 25 files,
1,500 changed text lines, 120 minutes, no more than eight workflow runs; zero live
workflow dispatches, merges or deployments. Binary media are reported separately.
Rollback: revert this packaging change; no resources or customer data are mutated.
Acceptance/evidence mapping: narrative/journey/reuse/engagement → this guide;
onboarding/navigation → README; honest preview → UI/accessibility test; portable
dispatcher → adapter tests; offline journey → scenario self-tests/report;
catalog submission → draft metadata with unresolved gates, not acceptance.

## Local bootstrap and demo

```sh
npm run bootstrap
npm run bootstrap -- --apply
npm run config:validate
npm run demo:offline
npm run dev:api
```

The first bootstrap command is a dry run. `--apply` preserves an existing
`.env`, copies `.env.example` only when absent, runs `npm ci`, and builds.
The offline demo requires no credentials, GitHub calls, Azure calls, or network
access after dependencies are installed. Open `http://localhost:3000` after the
API starts to view the control room.

## GitHub reconciliation

Review `.github/labels.yml`, `.github/autonomy/repository-settings.json`, and
`.github/autonomy/ruleset.json`. Authenticate `gh`, then:

```sh
GITHUB_REPOSITORY=owner/repo npm run reconcile:github
CONFIRM_GITHUB_RECONCILE=owner/repo GITHUB_REPOSITORY=owner/repo \
  npm run reconcile:github -- --apply
```

The first command prints planned API calls. Only the second applies settings.
After apply, rerun the dry run and `npm run verify:agentic-sync`.

Before enabling agentic or autonomous integration workflows, install the
organization-owned **Dark Factory Mage** GitHub App on this repository. Set
organization secrets `DARK_FACTORY_MAGE_APP_CLIENT_ID` and
`DARK_FACTORY_MAGE_APP_PRIVATE_KEY` must be visible to this repository. Do
not expose `DARK_FACTORY_MAGE_APP_CLIENT_SECRET`; installation-token
authentication does not use the OAuth client secret. Do not store the
key in source control. The installation needs only the repository permissions
used here: Metadata read, Contents read/write, Workflows read/write, Actions
read/write, Deployments read/write, Issues read/write, and Pull requests
read/write. Keep
administration write on a separate operator credential used only for explicit
ruleset reconciliation. Each privileged job mints a short-lived installation
token limited to the current repository; agentic safe-output jobs receive the
key, while reasoning jobs do not. Copilot inference uses
`copilot-requests: write` and organization billing.

Initial implementation uses gh-aw's App-authenticated `create-pull-request`
safe output. Repair uses `push-to-pull-request-branch` for the one reconciled PR.
Both request an App-authenticated extra commit so normal CI events fire. Do not
configure `GH_AW_GITHUB_TOKEN`, `GH_AW_CI_TRIGGER_TOKEN`, a user PAT, or
`assign-to-agent`.

Validate the compiled credential boundary without exposing the secret:

```sh
npm run verify:agentic-credentials
DARK_FACTORY_MAGE_APP_CLIENT_ID=... \
DARK_FACTORY_MAGE_APP_PRIVATE_KEY_PATH=path/to/private-key.pem \
GITHUB_REPOSITORY=The-weyland-yutani-corporation/dark-factory-demo \
  node scripts/validate-agentic-credentials.mjs --runtime
gh aw compile --strict --validate --poutine
gh aw lint
```

The required ruleset context is
`autonomous-integration/evidence`, bound to the GitHub Actions App
(`integration_id` 15368). `verify`, `dependency-security`, `codeql`, and
`trivy` are also required and run for pull requests and merge groups. Applying
the reviewed ruleset remains an explicit operator action; validation never
changes live settings.

## Azure what-if and deployment

Never deploy from local validation. Authenticate with the intended subscription,
create a parameters file outside source control, then review:

```sh
az deployment group what-if \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

After organizational approval, the corresponding live command is
`az deployment group create` with the same arguments. Configure GitHub OIDC,
least-privilege roles, variables, private runner connectivity, alerts, and the
authenticated alert adapter before enabling delivery workflows.

For a demo that must publish images from GitHub-hosted runners, start from
`infra/main.demo.bicepparam`. Its explicit
`containerRegistryPublicNetworkAccessEnabled=true` opt-in enables ACR's public
endpoint while retaining the private endpoint and keeping both the ACR admin
user and anonymous pull disabled. The GitHub OIDC identity still requires
registry-scoped `AcrPush`; no registry password is introduced. Production and
private-runner deployments should omit the parameter or set it to `false`.

## Teardown planning

```sh
npm run teardown:plan
```

This only prints prerequisites and inventory commands. It refuses `--apply`.
Azure resource-group deletion has no what-if mode; inventory resources, locks,
role assignments, backups, private endpoints, retained logs, and dependencies,
then execute any approved deletion manually.

## Azure Monitor alert adapter

`apps/alert-adapter` is a Node.js 22 Azure Functions v4 application. Its
`POST /api/alerts/azure-monitor` trigger uses Functions `function`
authorization, accepts only Azure Monitor common-alert-schema payloads,
normalizes severity and correlation metadata, and emits
`azure-monitor-alert` or `container-apps-alert` repository dispatches to
`The-weyland-yutani-corporation/dark-factory-demo`.

The adapter uses its user-assigned managed identity for all Azure data-plane
access:

- **Key Vault Secrets User** on the existing vault to read
  `dark-factory-mage-private-key`.
- **Storage Blob Data Owner** on its deployment storage for the Functions host.
- **Storage Queue Data Contributor** for Functions host coordination.
- **Storage Table Data Contributor** on the same account for retry
  deduplication.
- Application Insights authenticated ingestion and Log Analytics diagnostics.

The Dark Factory Mage private key is never a Bicep parameter or application
setting. At runtime the adapter reads it from Key Vault, signs a GitHub App JWT,
mints a short-lived token for App `5122991` installation `168176539`, uses the
token once, and discards it. Do not configure a PAT or persist installation
tokens.

### Local verification

Azure Functions Core Tools is optional for repository validation. The tested
business logic does not need live Azure or GitHub access:

```sh
npm run build --workspace=@dark-factory/alert-adapter
npx vitest run tests/alert-adapter.test.ts
```

For an authenticated local end-to-end test, sign in with Azure CLI, use a
development vault and storage account, and provide the non-secret settings
documented in `infra/modules/alert-adapter.bicep`. Never put the PEM value in
`local.settings.json`.

### Live activation prerequisites

The repository intentionally does not deploy or activate the adapter. Before a
live deployment:

1. Install Dark Factory Mage on the target repository with **Metadata read** and
   **Contents write** (required for `repository_dispatch`). Confirm installation
   ID `168176539`.
2. From an approved private-network operator, store the PEM as Key Vault secret
   `dark-factory-mage-private-key`. Keep the secret value outside source,
   parameters, deployment outputs, and logs.
3. Deploy `infra/main.bicep`, then publish the built
   `apps/alert-adapter` package to the provisioned Flex Consumption Function
   App. Existing application and worker image deployment remains unchanged.
4. Retrieve or rotate the `azure-monitor-alert` function key. Supply it as the
   secure `alertAdapterFunctionKey` deployment parameter. An empty value leaves
   the Action Group Function receiver disabled.
5. Review Azure Monitor Action Group test notifications. The receiver uses the
   common alert schema and a function-key URL; do not replace it with an
   anonymous webhook.
6. Confirm the Function integration subnet resolves the private Key Vault
   endpoint and outbound HTTPS reaches `api.github.com`.
7. Confirm the `incident-operations.yml` workflow accepts both dispatch event
   types and that Table Storage deduplication suppresses repeated deliveries.

The adapter records only normalized identifiers and status in logs. The storage
entity has a seven-day expiry marker; a later delivery can reclaim an expired
key, while fired and resolved states use different deduplication keys.

## Troubleshooting

| Symptom                        | Action                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| API exits at startup           | Run `npm run config:validate`; fix all reported values.                                                                      |
| Factory endpoint returns 503   | Use demo mode locally or provide a production `FactoryOperationsAdapter`.                                                    |
| Dashboard says API unavailable | Check `/healthz`, `/readyz`, browser CORS, and `VITE_API_BASE_URL`.                                                          |
| GitHub dry run fails           | Run `gh auth status`; confirm repository access and ruleset permissions.                                                     |
| Agentic sync differs           | Install the pinned `gh aw` extension, compile, then run `npm run verify:agentic-sync`.                                       |
| Lifecycle workflow stops early | Validate the Dark Factory Mage App installation, `DARK_FACTORY_MAGE_APP_CLIENT_ID`, and `DARK_FACTORY_MAGE_APP_PRIVATE_KEY`. |
| Azure what-if fails            | Confirm subscription, resource group, Bicep compiler, parameter file, and RBAC.                                              |
| Delivery regression            | Use the rollback workflow, preserve the correlation envelope, and verify the prior revision.                                 |
| Metrics look stale             | Compare `generatedAt` and adapter source; demo data is fixed except for generation time.                                     |
