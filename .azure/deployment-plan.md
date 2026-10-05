# Azure Deployment Plan

> **Status:** Planning

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
| GitHub repository | `VeVarunSharma/dark-factory-demo`                                       |
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

### Private Registry Runner Decision

The registry is intentionally private. The current workflow performs a Docker
push, so it requires a runner with VNet connectivity. No repository runner is
currently registered. Before enabling delivery, choose one of these reviewed
paths:

- **Preferred secure path:** provision a hardened ephemeral self-hosted runner
  in the VNet and set `DELIVERY_RUNNER` to its label.
- **Alternative implementation path:** change delivery to an Azure-native
  registry build that is independently attested and does not require direct
  runner access.

The production workflow must remain disabled until one path is validated.

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

### Phase 2: Preparation

- [ ] Resolve the private delivery runner decision.
- [ ] Generate a non-secret `infra/main.parameters.json` from confirmed values.
- [ ] Add the GitHub OIDC deployment identity and federated credential to IaC or
      an explicitly reviewed bootstrap command.
- [ ] Validate the application image locally or in CI.
- [ ] Run GitHub reconciliation dry run and review the exact mutations.
- [ ] Update this plan to `Ready for Validation`.

### Phase 3: Validation

- [ ] Invoke `azure-validate`.
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

The `azure-validate` skill has not run yet. It must record actual commands,
results, and timestamps here before changing the plan status to `Validated`.

| Check              | Command Run                  | Result  | Timestamp  |
| ------------------ | ---------------------------- | ------- | ---------- |
| Validation handoff | Not run before plan approval | Pending | 2026-10-04 |

**Validated by:** Not yet validated  
**Validation timestamp:** Not yet validated

## 9. Identity, RBAC, and GitHub Configuration

### Azure identity

- PostgreSQL administrator:
  `sharmave@MngEnvMCAP744360.onmicrosoft.com`
  (`6ab9e067-26ba-469d-a1de-4b5a1571bd3f`).
- GitHub deployment identity: create a dedicated user-assigned identity.
- Federated subject:
  `repo:VeVarunSharma/dark-factory-demo:ref:refs/heads/main`.
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

## 10. Risks and Rollback

| Risk                                                  | Mitigation                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Private ACR is unreachable from GitHub-hosted runners | Keep delivery disabled until a private runner or reviewed Azure-native build path exists                    |
| Initial application images do not exist               | Deploy base infrastructure with `deployApplications=false`, then build images before application deployment |
| OIDC identity has excessive scope                     | Assign roles at ACR and Container App resource scopes, not subscription scope                               |
| PostgreSQL administrator is an individual             | Acceptable for the demo; replace with an Entra security group for shared production ownership               |
| Merge queue/ruleset blocks all merges                 | Apply only after all required workflows exist on `main`; retain an explicit operator recovery procedure     |
| Bad application revision                              | Multiple revisions, progressive traffic, health/synthetic checks, and automatic rollback                    |
| Database migration incompatibility                    | Migration hook remains opt-in and must be backward-compatible and retry-safe                                |
| Resource cost growth                                  | Consumption Container Apps, low replica minimums, non-HA PostgreSQL for the initial demo, 30-day logs       |

Rollback uses the prior active Container Apps revision. Infrastructure
deployment uses incremental mode and must be preceded by what-if. No teardown or
resource deletion is part of this plan.

## 11. Files

| File                         | Purpose                           | Status                         |
| ---------------------------- | --------------------------------- | ------------------------------ |
| `.azure/deployment-plan.md`  | Deployment source of truth        | Complete for approval          |
| `infra/main.bicep`           | Resource-group infrastructure     | Existing and locally validated |
| `infra/modules/*.bicep`      | Modular Azure resources           | Existing and locally validated |
| `Dockerfile`                 | Combined application/worker image | Existing and locally validated |
| `infra/main.parameters.json` | Non-secret environment values     | Generate after approval        |

## 12. Next Step

Review and approve this plan. After approval, preparation will resolve the
private runner choice, generate deployment parameters and OIDC configuration,
run `azure-validate`, present the Azure what-if result, and request a final
deployment confirmation before creating cloud resources or changing repository
permissions.
