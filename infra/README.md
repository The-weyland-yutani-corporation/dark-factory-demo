# Azure infrastructure

## Adapting safely for another account

The checked-in `main.demo*.bicepparam` files are the original live demonstration
baseline, not portable customer defaults. Do not deploy them unchanged or copy
their operator identity into a customer submission. Preserve the tested baseline
and prepare a customer-specific parameter file outside source control:
use `main.bicep`, supply `namePrefix`, `environmentName`, `location`,
`postgresAdministratorObjectId` (prefer a group) and
`postgresAdministratorPrincipalName`; select the intended tenant/subscription
and resource group explicitly. Start with `deployApplications=false` and keep
registry public access disabled unless the scoped demo exception is intended.

The alert-adapter module currently supplies this repository's App and repository
settings. Replace all four `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`,
`GITHUB_REPOSITORY_OWNER` and `GITHUB_REPOSITORY_NAME` settings for another account
before publishing/enabling the adapter. Runtime defaults no longer route to the
original account when configuration is absent. Provision the new App installation,
private-key vault access and outbound connectivity; never copy a PEM or function
key into parameters, logs or catalog assets.

Use the runbook's what-if, permissions, image provenance, recovery and teardown
procedures. A local demo does not authorize a deployment; the existing authorized
goal/independent-review/integration path is unchanged.

`main.bicep` deploys a secure, modular Azure baseline for the web, API, and
worker workloads:

- Azure Container Apps workload-profiles environment on a dedicated VNet
  subnet, with encrypted peer traffic and Azure Monitor log routing.
- Three Container Apps with separate user-assigned managed identities.
- Premium Azure Container Registry with admin and anonymous access disabled,
  private endpoint access, and identity-based `AcrPull`. Public network access
  is disabled by default and can be explicitly enabled for authenticated demo
  publication from GitHub-hosted runners.
- Workspace-based Application Insights and Log Analytics.
- RBAC-enabled Key Vault with purge protection, public access disabled, and a
  private endpoint.
- Microsoft Entra-only PostgreSQL Flexible Server and application database on
  a delegated subnet.
- Diagnostic settings for platform services and PostgreSQL CPU/storage alerts.

## Demo deployment inputs

After a pull request passes the exact-head integration and self-modification
gates, merges through the merge queue, and the resulting `main` commit passes
deterministic verification, `.github/workflows/infrastructure.yml` deploys the
fixed `infra/main.bicep` and `infra/main.demo.bicepparam` paths. It authenticates
with repository-configured Azure OIDC variables, validates and runs what-if,
rejects deletes and unsupported or replacement-like property changes, and
applies only in Incremental mode. The workflow has no caller-supplied deployment
inputs.

Configure `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and
`AZURE_RESOURCE_GROUP`. Grant the federated identity only the resource-group
deployment permissions required by this template, including role-assignment
writes at that scope for the template's managed-identity bindings. The workflow
publishes its exact-source verification evidence, validation result, what-if,
safety verdict, compiled template, and deployment result for 30 days.

The checked-in parameter files contain only non-secret values:

| Stage | Parameter file | Application resources |
| --- | --- | --- |
| Base infrastructure | `infra/main.demo.bicepparam` | `deployApplications=false` |
| Application activation | `infra/main.demo.applications.bicepparam` | `deployApplications=true` |

Both files target subscription
`ad92e163-a85e-40cc-bb50-054b0b8197a8`, tenant
`1cf61a60-a877-46a7-86bc-a8f76b6ab441`, resource group
`rg-dark-factory-demo-eus2`, and location `eastus2`. Subscription and resource
group are deployment-command scope, so they are intentionally not Bicep
parameters.

The files configure the `darkfactory` / `demo` naming inputs, PostgreSQL Entra
administrator `sharmave@MngEnvMCAP744360.onmicrosoft.com`
(`6ab9e067-26ba-469d-a1de-4b5a1571bd3f`), image repository `dark-factory`,
non-HA PostgreSQL, and a non-zone-redundant Container Apps environment. The
demo opts in to authenticated public ACR access for GitHub-hosted runners. ACR
admin credentials and anonymous pull remain disabled, and the private endpoint
remains deployed.

Compile the template and every checked-in parameter file without contacting
Azure:

```powershell
npm run verify:bicep
```

After approval, the two deployment commands are:

```powershell
az account set --subscription ad92e163-a85e-40cc-bb50-054b0b8197a8

az deployment group create `
  --name darkfactory-demo-bootstrap `
  --resource-group rg-dark-factory-demo-eus2 `
  --template-file infra\main.bicep `
  --parameters infra\main.demo.bicepparam

# Build and push dark-factory:0.1.0 before activating the applications.
az deployment group create `
  --name darkfactory-demo-applications `
  --resource-group rg-dark-factory-demo-eus2 `
  --template-file infra\main.bicep `
  --parameters infra\main.demo.applications.bicepparam
```

Do not run the second stage until the exact `dark-factory:0.1.0` image exists
in the registry. For later releases, override `imageTag` with the immutable
release identifier in both the image publication and second-stage deployment.

## Deployment outputs to GitHub variables

After the second stage succeeds, map the Bicep outputs and fixed deployment
scope to repository variables as follows. These commands are documentation;
they are not run by parameter validation.

```powershell
$deployment = az deployment group show `
  --name darkfactory-demo-applications `
  --resource-group rg-dark-factory-demo-eus2 `
  --query properties.outputs | ConvertFrom-Json

$registryServer = $deployment.containerRegistryLoginServer.value
$registryName = $registryServer.Split('.')[0]

gh variable set AZURE_TENANT_ID --body '1cf61a60-a877-46a7-86bc-a8f76b6ab441'
gh variable set AZURE_SUBSCRIPTION_ID --body 'ad92e163-a85e-40cc-bb50-054b0b8197a8'
gh variable set AZURE_RESOURCE_GROUP --body 'rg-dark-factory-demo-eus2'
gh variable set AZURE_CONTAINER_APP_NAME --body $deployment.applicationName.value
gh variable set AZURE_CONTAINER_REGISTRY_NAME --body $registryName
gh variable set AZURE_CONTAINER_REGISTRY_SERVER --body $registryServer
gh variable set AZURE_IMAGE_REPOSITORY --body 'dark-factory'
gh variable set DELIVERY_RUNNER --body 'ubuntu-latest'
gh variable set PRODUCTION_BASE_URL --body $deployment.applicationUrl.value
```

`AZURE_CLIENT_ID` is not an application deployment output. Set it to the
`clientId` of the separately approved GitHub OIDC user-assigned identity after
that identity and its federated credential exist:

```powershell
$clientId = az identity show `
  --resource-group rg-dark-factory-demo-eus2 `
  --name <approved-github-oidc-identity-name> `
  --query clientId -o tsv
gh variable set AZURE_CLIENT_ID --body $clientId
```

No credential, PAT, GitHub App installation token, or other mutable secret
belongs in a Bicep parameter file or repository variable.

## Immutable network assumptions

Treat the following choices as immutable after the first deployment:

1. The VNet address space and all three subnet prefixes must not overlap with
   connected networks, Azure platform-reserved ranges, or each other.
2. `snet-container-apps` is dedicated to the Container Apps environment and is
   delegated to `Microsoft.App/environments`. Changing its prefix or the
   environment's VNet attachment requires environment replacement.
3. `snet-postgresql` is dedicated to PostgreSQL Flexible Server and delegated
   to `Microsoft.DBforPostgreSQL/flexibleServers`. Its private DNS zone name is
   derived from the server name; server renames are replacements.
4. `snet-private-endpoints` is reserved for private endpoints. Private endpoint
   network policies remain disabled.
5. The Container Apps environment has public ingress so the web and API can be
   reached without an application gateway. A fully internal environment is a
   separate topology and should be selected before the first deployment.
6. ACR and Key Vault have public network access disabled by default. Image
   pulls and vault access depend on VNet integration and private DNS links.
   The ACR public endpoint may be explicitly enabled for an authenticated demo
   publishing path; this does not remove its private endpoint. Key Vault
   remains private-only.
7. Zone redundancy and PostgreSQL high availability are opt-in because region
   and capacity support vary. Enabling either later may cause replacement or
   downtime; decide these settings before production.
8. Log Analytics and Application Insights ingestion/query endpoints remain
   public, protected by Microsoft Entra authentication and disabled local
   authentication. Private Azure Monitor Link Scope is intentionally excluded
   because it requires organization-wide DNS and monitoring topology decisions.

## Identity and database bootstrap

Container Apps authenticate to ACR, Key Vault, Application Insights, and Azure
SDK clients with their user-assigned managed identities. Key Vault contains no
deployment-created secrets.

Azure RBAC does not create PostgreSQL database roles. After deployment, connect
as the configured Microsoft Entra administrator and create least-privilege
database principals for the API and worker identity display names/client IDs.
This one-time database bootstrap is required before those workloads can access
PostgreSQL.

## Operational notes

- Alerts are deployed disabled when `alertEmailAddress` is empty.
- Production incident automation consumes Azure common-alert-schema events
  through an Azure-native authenticated Logic App or Function that sends a
  GitHub `repository_dispatch`. Keep GitHub App credentials in that adapter's
  managed Key Vault reference; never add an unauthenticated Action Group
  webhook or pass credentials to this Bicep deployment.
- Application Insights local authentication is disabled. Workloads use
  `APPLICATIONINSIGHTS_AUTHENTICATION_STRING=Authorization=AAD`.
- The web image must listen on port `8080`; the API must listen on `3000`.
  The worker has no ingress.
- With the secure default, ACR image publication must originate from a network
  with access to the VNet, or use an approved Azure-hosted build path that
  supports the registry network configuration. Demo deployments may opt in to
  authenticated public access for GitHub-hosted runners; use OIDC with
  registry-scoped `AcrPush`, never admin credentials.
