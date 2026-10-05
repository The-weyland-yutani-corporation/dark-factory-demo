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

Before enabling agentic or autonomous integration workflows, install the
organization-owned **Dark Factory Mage** GitHub App on this repository. Set
repository variable `DARK_FACTORY_MAGE_APP_ID` to `5122991` and repository
secret `DARK_FACTORY_MAGE_PRIVATE_KEY` to its PEM private key. Do not store the
key in source control. The installation needs only the repository permissions
used here: Metadata read, Contents read, Actions read/write, Deployments
read/write, Issues read/write, and Pull requests read/write. Keep
administration write on a separate operator credential used only for explicit
ruleset reconciliation. Each privileged job mints a short-lived installation
token limited to the current repository; agentic safe-output jobs receive the
key, while reasoning jobs do not. Copilot inference uses
`copilot-requests: write` and organization billing.

Validate the compiled credential boundary without exposing the secret:

```sh
npm run verify:agentic-credentials
DARK_FACTORY_MAGE_APP_ID=5122991 \
DARK_FACTORY_MAGE_PRIVATE_KEY_PATH=path/to/private-key.pem \
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

## Troubleshooting

| Symptom                        | Action                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| API exits at startup           | Run `npm run config:validate`; fix all reported values.                                                           |
| Factory endpoint returns 503   | Use demo mode locally or provide a production `FactoryOperationsAdapter`.                                         |
| Dashboard says API unavailable | Check `/healthz`, `/readyz`, browser CORS, and `VITE_API_BASE_URL`.                                               |
| GitHub dry run fails           | Run `gh auth status`; confirm repository access and ruleset permissions.                                          |
| Agentic sync differs           | Install the pinned `gh aw` extension, compile, then run `npm run verify:agentic-sync`.                            |
| Lifecycle workflow stops early | Validate the Dark Factory Mage App installation, `DARK_FACTORY_MAGE_APP_ID`, and `DARK_FACTORY_MAGE_PRIVATE_KEY`. |
| Azure what-if fails            | Confirm subscription, resource group, Bicep compiler, parameter file, and RBAC.                                   |
| Delivery regression            | Use the rollback workflow, preserve the correlation envelope, and verify the prior revision.                      |
| Metrics look stale             | Compare `generatedAt` and adapter source; demo data is fixed except for generation time.                          |
