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
