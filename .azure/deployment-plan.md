# Azure Deployment Plan

> **Status:** Ready for Validation

Generated: 2026-10-04

---

## 1. Project Overview

**Goal:** Activate the GitHub-centric dark factory and deploy the Control Room
application to Azure Container Apps with GitHub OIDC, immutable image delivery,
private data-plane dependencies, production verification, and automatic
rollback.

**Path:** Add deployment configuration and live platform setup to an existing,
validated project.

The repository already contains the application, GitHub Agentic Workflows,
deterministic CI/evidence gates, integration policy, modular Bicep, production
delivery workflows, incident feedback loop, and self-modification guardrails.

## 2. Requirements

| Attribute         | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Classification    | Development / production-like demonstration                             |
| Scale             | Small                                                                   |
| Budget            | Cost-optimized                                                          |
| Subscription      | ME-MngEnvMCAP744360-sharmave-1 (`ad92e163-a85e-40cc-bb50-054b0b8197a8`) |
| Tenant            | Contoso (`1cf61a60-a877-46a7-86bc-a8f76b6ab441`)                        |
| Location          | `eastus2`                                                               |
| Resource group    | New: `rg-dark-factory-demo-eus2`                                        |
| GitHub repository | `The-weyland-yutani-corporation/dark-factory-demo`                      |
| Default branch    | `main`                                                                  |

`eastus2` was selected because the subscription already has workloads in that
region and the required Container Apps, PostgreSQL Flexible Server, private
networking, registry, identity, and monitoring services are available there.

## 3. Components Detected

| Component                | Type                | Technology                                | Path                     |
| ------------------------ | ------------------- | ----------------------------------------- | ------------------------ |
| Control Room             | Frontend            | React + Vite                              | `apps/web`               |
| Control Room API         | API and static host | Fastify + Node.js 22                      | `apps/api`               |
| Factory worker           | Background worker   | Node.js 22                                | `apps/worker`            |
| Azure alert adapter      | Azure Function      | TypeScript + Azure Functions v4 / Node 22 | `apps/alert-adapter`     |
| Shared contracts         | Library             | TypeScript                                | `packages/contracts`     |
| Policy engine            | Library             | TypeScript                                | `packages/policy-engine` |
| Observability            | Library             | TypeScript                                | `packages/observability` |
| Container image          | Runtime artifact    | Multi-stage Dockerfile                    | `Dockerfile`             |
| Azure infrastructure     | IaC                 | Modular Bicep                             | `infra`                  |
| Repository control plane | Automation          | GitHub Actions + GitHub Agentic Workflows | `.github`                |

The single runtime image contains the combined web/API application and worker.
Container Apps overrides the image command so the application runs
`apps/api/dist/index.js` and the worker runs `apps/worker/dist/index.js`.

## 4. Recipe Selection

**Selected:** Direct Bicep deployment with Azure CLI.

**Rationale:**

- The repository already has a secure modular `infra/main.bicep`.
- Existing GitHub delivery workflows use direct Azure CLI and GitHub OIDC.
- The deployment requires a two-stage bootstrap: base infrastructure first,
  then immutable images and application revisions.
- Adding an AZD wrapper would duplicate the established deployment contract.

## 5. Architecture

**Stack:** GitHub Actions and Agentic Workflows + Azure Container Apps.

### Service Mapping

| Component        | Azure Service                    | Configuration                                                                     |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| Combined web/API | Azure Container Apps             | Consumption workload profile, 0.5 vCPU / 1 GiB, 1-10 replicas, external HTTPS     |
| Worker           | Azure Container Apps             | Consumption workload profile, 0.5 vCPU / 1 GiB, 1-3 replicas, internal/no ingress |
| Container images | Azure Container Registry         | Premium, private endpoint, admin disabled                                         |
| Relational state | PostgreSQL Flexible Server       | `Standard_D2ds_v5`, 128 GiB, Entra-only, private delegated subnet                 |
| Runtime secrets  | Azure Key Vault                  | RBAC, purge protection, private endpoint                                          |
| Network          | Azure Virtual Network            | Dedicated Container Apps, PostgreSQL, and private endpoint subnets                |
| Logs             | Log Analytics                    | Workspace-based centralized logs                                                  |
| APM              | Application Insights             | Workspace-based, local auth disabled                                              |
| Operations       | Azure Monitor                    | Action group and PostgreSQL CPU/storage alerts                                    |
| Alert bridge     | Azure Functions Flex Consumption | Function-authenticated common-alert-schema receiver and GitHub App dispatch       |
| Runtime identity | User-assigned managed identities | Separate application and worker identities                                        |
| CI/CD identity   | User-assigned managed identity   | GitHub OIDC federated to `main`; no client secret                                 |

### Deployment Sequence

1. Create the resource group.
2. Deploy base infrastructure with `deployApplications=false`.
3. Create a dedicated GitHub OIDC deployment identity and federated credential.
4. Assign `AcrPush` on ACR and scoped Container Apps deployment permissions.
5. Build and push the immutable image.
6. Deploy the application and worker using the digest-backed image tag.
7. Configure GitHub repository variables, secret, production environment,
   labels, settings, and required ruleset.
8. Run production health, readiness, version, synthetic, telemetry, and rollback
   verification.

### Authenticated Demo Registry Access

The demo parameter files explicitly set
`containerRegistryPublicNetworkAccessEnabled=true`, allowing
identity-authenticated publication from GitHub-hosted runners. ACR admin access
and anonymous pull remain disabled, the private endpoint remains deployed, and
the delivery identity still requires registry-scoped `AcrPush`.

Set `DELIVERY_RUNNER=ubuntu-latest` for this demo only. A production or private
environment should restore the secure default and use a connected runner or an
approved Azure-native build path.

## 6. Provisioning Limit Checklist

Azure Resource Graph found two existing Application Insights components and two
Log Analytics workspaces in `eastus2`; the other planned resource families have
zero existing regional instances. Azure Quota CLI returned the live Container
Apps and networking limits below.

| Resource Type                                      | Number to Deploy | Total After Deployment |                          Limit / Quota | Source and Notes                                                              |
| -------------------------------------------------- | ---------------: | ---------------------: | -------------------------------------: | ----------------------------------------------------------------------------- |
| `Microsoft.App/managedEnvironments`                |                1 |                      1 |                                     50 | Azure Quota CLI: `ManagedEnvironmentCount`, current usage 0                   |
| Container Apps consumption cores                   |        9 maximum |                      9 |                                 20,000 | Azure Quota CLI: `SandboxCores`, current usage 0; maximum configured replicas |
| `Microsoft.App/containerApps`                      |                2 |                      2 | Covered by environment and core quotas | Combined web/API plus worker                                                  |
| `Microsoft.Network/virtualNetworks`                |                1 |                      1 |                                  1,000 | Azure Quota CLI, current usage 0                                              |
| Subnets in the VNet                                |                3 |                      3 |                         3,000 per VNet | Azure Quota CLI                                                               |
| `Microsoft.Network/privateEndpoints`               |                2 |                      2 |                                 65,536 | Azure Quota CLI, current usage 0                                              |
| `Microsoft.ContainerRegistry/registries`           |                1 |                      1 |                   100 per subscription | Azure Resource Graph count + official ACR limits                              |
| `Microsoft.DBforPostgreSQL/flexibleServers`        |                1 |                      1 |               20 per region by default | Azure Resource Graph count + Azure service limits                             |
| `Microsoft.KeyVault/vaults`                        |                1 |                      1 |                         500 per region | Azure Resource Graph count + Azure service limits                             |
| `Microsoft.OperationalInsights/workspaces`         |                1 |                      3 |                         250 per region | Azure Resource Graph count 2 + Azure service limits                           |
| `Microsoft.Insights/components`                    |                1 |                      3 |                         100 per region | Azure Resource Graph count 2 + Azure service limits                           |
| `Microsoft.ManagedIdentity/userAssignedIdentities` |                3 |                      3 |                         200 per region | App, worker, and GitHub deployment identities                                 |
| `Microsoft.Network/privateDnsZones`                |                3 |                      3 |                 1,000 per subscription | ACR, Key Vault, and PostgreSQL zones                                          |
| `Microsoft.Insights/actionGroups`                  |                1 |                      1 |  Within documented subscription limits | Disabled when no alert email is supplied                                      |
| `Microsoft.Insights/metricAlerts`                  |                2 |                      2 |  Within documented subscription limits | PostgreSQL CPU and storage alerts                                             |

**Status:** All planned resources are well below current limits.

Quota sources:

- Azure Quota CLI, queried for `Microsoft.App` and `Microsoft.Network` in
  `eastus2`.
- Azure Resource Graph, scoped to subscription
  `ad92e163-a85e-40cc-bb50-054b0b8197a8`.
- [Azure subscription and service limits](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits).
- [Azure Container Registry limits](https://learn.microsoft.com/azure/container-registry/container-registry-skus).

## 7. Execution Checklist

### Phase 1: Planning

- [x] Analyze workspace.
- [x] Gather requirements.
- [x] Select the only enabled/default subscription.
- [x] Select a supported location.
- [x] Prepare resource inventory.
- [x] Fetch quotas and validate capacity.
- [x] Scan the codebase and deployment workflows.
- [x] Select the direct Bicep recipe.
- [x] Plan the architecture and bootstrap sequence.
- [ ] User approves this plan and the planned cloud/repository changes.
- [x] User explicitly requested implementation without live deployment.

### Phase 2: Preparation

- [x] Implement and test the Azure Monitor alert adapter.
- [x] Add managed identity, storage deduplication, Key Vault RBAC, monitoring,
      and Action Group Function receiver wiring.
- [x] Select authenticated public ACR access and GitHub-hosted delivery for the
      demo.
- [x] Generate non-secret two-stage demo Bicep parameter files from confirmed
      values.
- [x] Compile `main.bicep` and both demo parameter files locally.
- [ ] Add the GitHub OIDC deployment identity and federated credential to IaC or
      an explicitly reviewed bootstrap command.
- [ ] Validate the application image locally or in CI.
- [ ] Run GitHub reconciliation dry run and review the exact mutations.
- [x] Update this plan to `Ready for Validation`.

### Phase 3: Validation

- [ ] Invoke `azure-validate`.
- [x] All local validation checks pass.
  - [x] Core local validation: Bicep compiler build for `infra/main.bicep`
        and both checked-in `.bicepparam` files.
  - [x] Lint, typecheck, build, unit tests, operations tests, IaC policy,
        secret scan, and production dependency audit.
  - [ ] Azure deployment validation and what-if against the target resource
        group (live prerequisite; intentionally not run for this no-deployment
        task).
  - [ ] Azure Policy validation against the target subscription (live
        prerequisite).
- [ ] Validate Bicep and parameters.
- [ ] Run resource-group deployment validation and what-if.
- [ ] Validate Azure role prerequisites.
- [ ] Validate GitHub credential, variables, ruleset, workflows, and runner.
- [ ] Populate the Validation Proof section.
- [ ] Set status to `Validated` only through `azure-validate`.

### Phase 4: Deployment

- [ ] Invoke `azure-deploy`.
- [ ] Create the resource group.
- [ ] Deploy base infrastructure.
- [ ] Configure OIDC/RBAC and GitHub settings.
- [ ] Build and push the immutable image.
- [ ] Deploy application revisions.
- [ ] Verify endpoints, telemetry, role assignments, rollback, and incident
      feedback.
- [ ] Report fully qualified production URLs.
- [ ] Set status to `Deployed`.

## 8. Validation Proof

| Check                    | Command Run                                                                  | Result                                              | Timestamp  |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------- | ---------- |
| Alert adapter tests      | `npx vitest run tests/alert-adapter.test.ts`                                 | Passed: 5 tests                                     | 2026-10-05 |
| Full unit tests          | `npm run test:unit`                                                          | Passed: 11 files, 49 tests                          | 2026-10-05 |
| Operations integration   | `npm run test:operations`                                                    | Passed: 7 tests                                     | 2026-10-05 |
| Lint                     | `npm run lint`                                                               | Passed                                              | 2026-10-05 |
| TypeScript               | `npm run typecheck`                                                          | Passed                                              | 2026-10-05 |
| Production build         | `npm run build`                                                              | Passed                                              | 2026-10-05 |
| Formatting               | `npm run format:check`                                                       | Passed                                              | 2026-10-05 |
| Bicep compile            | `npm run verify:bicep`                                                       | Passed: main and both checked-in parameter files    | 2026-10-05 |
| IaC policy               | `npm run scan:iac`                                                           | Passed: 11 Bicep files                              | 2026-10-05 |
| Secret scan              | `npm run scan:secrets`                                                       | Passed: 176 files, no private key or token material | 2026-10-05 |
| Production dependencies  | `npm run scan:dependencies`                                                  | Passed: 0 vulnerabilities                           | 2026-10-05 |
| Static RBAC review       | `infra/modules/alert-adapter.bicep` and `infra/modules/key-vault.bicep`      | Passed: resource-scoped data-plane roles            | 2026-10-05 |
| Azure validate / what-if | Not run: requires live target resource group and was outside no-deploy scope | Live prerequisite                                   | 2026-10-05 |
| Azure Policy validation  | Not run against subscription                                                 | Live prerequisite                                   | 2026-10-05 |

**Validated by:** Local repository validation through `azure-validate`; live
Azure validation remains pending.
**Validation timestamp:** 2026-10-05

## 9. Identity, RBAC, and GitHub Configuration

### Alert adapter role assignment verification

- **Status:** Static verification complete.
- **Identity:** Dedicated `${baseName}-alert-id` user-assigned managed identity.
- **Key Vault:** Key Vault Secrets User, scoped to the existing vault.
- **Storage:** Storage Blob Data Owner, Storage Queue Data Contributor, and
  Storage Table Data Contributor, scoped to the adapter storage account.
- **Telemetry:** Application Insights authenticated ingestion role through the
  existing monitoring module.
- **Network:** Dedicated delegated Functions integration subnet with private
  Key Vault DNS resolution.
- **Issues:** No subscription- or resource-group-scoped runtime roles were
  introduced. Live role verification remains a post-deployment prerequisite.

### Azure identity

- PostgreSQL administrator:
  `sharmave@MngEnvMCAP744360.onmicrosoft.com`
  (`6ab9e067-26ba-469d-a1de-4b5a1571bd3f`).
- GitHub deployment identity: create a dedicated user-assigned identity.
- Federated subject:
  `repo:The-weyland-yutani-corporation/dark-factory-demo:ref:refs/heads/main`.
- Deployment identity roles:
  - `AcrPush` on the registry.
  - The least-privilege Container Apps update role supported by the target
    resources; use `Container Apps Contributor` only when narrower custom
    permissions are insufficient.
  - Reader access required for verification.

### GitHub repository

Current live audit:

- No repository Actions secrets.
- No repository Actions variables.
- No self-hosted runners.
- No production environment.
- No repository ruleset.
- Repository administrator access is available.
- Reconciliation dry run proposes 23 labels, repository merge settings, and the
  autonomous integration ruleset.

Required setup:

- Secret: `GH_AW_GITHUB_TOKEN`, using a narrowly scoped event-producing
  fine-grained PAT or GitHub App token.
- Variables:
  `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
  `AZURE_RESOURCE_GROUP`, `AZURE_CONTAINER_APP_NAME`,
  `AZURE_CONTAINER_REGISTRY_NAME`, `AZURE_CONTAINER_REGISTRY_SERVER`,
  `AZURE_IMAGE_REPOSITORY`, `DELIVERY_RUNNER`, and `PRODUCTION_BASE_URL`.
- Production environment without human approval rules.
- Apply the reviewed labels, merge settings, merge queue, and exact-SHA required
  check ruleset.

Creating or storing the persistent GitHub credential and changing repository or
Azure permissions require explicit approval immediately before execution.

### Confirmed demo parameters

| Input                          | Value                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Subscription                   | `ad92e163-a85e-40cc-bb50-054b0b8197a8`                                                  |
| Tenant                         | `1cf61a60-a877-46a7-86bc-a8f76b6ab441`                                                  |
| Resource group                 | `rg-dark-factory-demo-eus2`                                                             |
| Location                       | `eastus2`                                                                               |
| Name prefix / environment      | `darkfactory` / `demo`                                                                  |
| PostgreSQL Entra administrator | `sharmave@MngEnvMCAP744360.onmicrosoft.com` (`6ab9e067-26ba-469d-a1de-4b5a1571bd3f`)    |
| Image repository / initial tag | `dark-factory` / `0.1.0`                                                                |
| Availability                   | PostgreSQL HA disabled; Container Apps zone redundancy disabled                         |
| ACR access                     | Authenticated public endpoint enabled for the demo; admin and anonymous access disabled |
| Stage 1                        | `infra/main.demo.bicepparam` with `deployApplications=false`                            |
| Stage 2                        | `infra/main.demo.applications.bicepparam` with `deployApplications=true`                |

Subscription and resource group are Azure CLI deployment scope and therefore
do not appear as Bicep parameters.

### Exact output-to-GitHub-variable mapping

| GitHub variable                   | Source                                                                   |
| --------------------------------- | ------------------------------------------------------------------------ |
| `AZURE_CLIENT_ID`                 | `clientId` of the separately approved GitHub OIDC user-assigned identity |
| `AZURE_TENANT_ID`                 | Fixed tenant `1cf61a60-a877-46a7-86bc-a8f76b6ab441`                      |
| `AZURE_SUBSCRIPTION_ID`           | Fixed subscription `ad92e163-a85e-40cc-bb50-054b0b8197a8`                |
| `AZURE_RESOURCE_GROUP`            | Fixed resource group `rg-dark-factory-demo-eus2`                         |
| `AZURE_CONTAINER_APP_NAME`        | Stage 2 output `applicationName.value`                                   |
| `AZURE_CONTAINER_REGISTRY_SERVER` | Stage 2 output `containerRegistryLoginServer.value`                      |
| `AZURE_CONTAINER_REGISTRY_NAME`   | First DNS label of `containerRegistryLoginServer.value`                  |
| `AZURE_IMAGE_REPOSITORY`          | Fixed value `dark-factory`                                               |
| `DELIVERY_RUNNER`                 | Fixed demo value `ubuntu-latest`                                         |
| `PRODUCTION_BASE_URL`             | Stage 2 output `applicationUrl.value`                                    |

The executable PowerShell mapping commands are documented in
`infra/README.md`. No credential or mutable GitHub App installation token is
stored in these parameters.

## 10. Risks and Rollback

| Risk                                                   | Mitigation                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Demo ACR public endpoint broadens network reachability | Require OIDC and registry-scoped `AcrPush`; keep admin and anonymous access disabled                        |
| Initial application images do not exist                | Deploy base infrastructure with `deployApplications=false`, then build images before application deployment |
| OIDC identity has excessive scope                      | Assign roles at ACR and Container App resource scopes, not subscription scope                               |
| PostgreSQL administrator is an individual              | Acceptable for the demo; replace with an Entra security group for shared production ownership               |
| Merge queue/ruleset blocks all merges                  | Apply only after all required workflows exist on `main`; retain an explicit operator recovery procedure     |
| Bad application revision                               | Multiple revisions, progressive traffic, health/synthetic checks, and automatic rollback                    |
| Database migration incompatibility                     | Migration hook remains opt-in and must be backward-compatible and retry-safe                                |
| Resource cost growth                                   | Consumption Container Apps, low replica minimums, non-HA PostgreSQL for the initial demo, 30-day logs       |

Rollback uses the prior active Container Apps revision. Infrastructure
deployment uses incremental mode and must be preceded by what-if. No teardown or
resource deletion is part of this plan.

## 11. Files

| File                                      | Purpose                           | Status                                               |
| ----------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `.azure/deployment-plan.md`               | Deployment source of truth        | Parameter sections updated; overall approval pending |
| `infra/main.bicep`                        | Resource-group infrastructure     | Existing and locally compiled                        |
| `infra/modules/*.bicep`                   | Modular Azure resources           | Existing and locally compiled through `main.bicep`   |
| `Dockerfile`                              | Combined application/worker image | Existing and locally validated                       |
| `infra/main.demo.bicepparam`              | Stage 1 non-secret demo values    | Generated and locally compiled                       |
| `infra/main.demo.applications.bicepparam` | Stage 2 non-secret demo values    | Generated and locally compiled                       |
| `scripts/bicep-validate.mjs`              | Template and parameter compiler   | Updated to compile every `.bicepparam` file          |
| `tests/iac-parameters.test.ts`            | Parameter consistency tests       | Added and passing                                    |

## 12. Next Step

Review and approve the remaining cloud and repository changes. The non-secret
parameters are ready, but no deployment, OIDC identity creation, role
assignment, GitHub mutation, Azure validation/what-if, or credential creation
has run. After those approvals, complete the identity bootstrap and hand off to
`azure-validate`; only that validation flow may change this plan to
`Validated`.
