# Operations runbook

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

Before enabling agentic or autonomous integration workflows, configure the
repository secret `GH_AW_GITHUB_TOKEN` with an event-producing fine-grained
PAT (or use equivalent GitHub App token minting and rotation). Scope it to this repository only and
grant only Metadata read, Contents read, Issues read/write, Pull requests
read/write, Actions read, and Checks read/write. Add administration write only
to a separate operator credential used for explicit ruleset reconciliation;
the lifecycle credential must not manage repository settings. The credential
must be able to enqueue pull requests and assign Copilot when those features
are enabled. Do not use the built-in `GITHUB_TOKEN`, because its mutations do
not emit the follow-on issue label/comment events that drive lifecycle stages.

Validate the compiled credential boundary without exposing the secret:

```sh
npm run verify:agentic-credentials
GH_AW_GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo \
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

## Troubleshooting

| Symptom                        | Action                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| API exits at startup           | Run `npm run config:validate`; fix all reported values.                                      |
| Factory endpoint returns 503   | Use demo mode locally or provide a production `FactoryOperationsAdapter`.                    |
| Dashboard says API unavailable | Check `/healthz`, `/readyz`, browser CORS, and `VITE_API_BASE_URL`.                          |
| GitHub dry run fails           | Run `gh auth status`; confirm repository access and ruleset permissions.                     |
| Agentic sync differs           | Install the pinned `gh aw` extension, compile, then run `npm run verify:agentic-sync`.       |
| Lifecycle workflow stops early | Configure and validate `GH_AW_GITHUB_TOKEN`; no `GITHUB_TOKEN` fallback is permitted.        |
| Azure what-if fails            | Confirm subscription, resource group, Bicep compiler, parameter file, and RBAC.              |
| Delivery regression            | Use the rollback workflow, preserve the correlation envelope, and verify the prior revision. |
| Metrics look stale             | Compare `generatedAt` and adapter source; demo data is fixed except for generation time.     |
