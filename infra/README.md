# Azure infrastructure

`main.bicep` deploys a secure, modular Azure baseline for the web, API, and
worker workloads:

- Azure Container Apps workload-profiles environment on a dedicated VNet
  subnet, with encrypted peer traffic and Azure Monitor log routing.
- Three Container Apps with separate user-assigned managed identities.
- Premium Azure Container Registry with admin access disabled, private
  endpoint access, and identity-based `AcrPull`.
- Workspace-based Application Insights and Log Analytics.
- RBAC-enabled Key Vault with purge protection, public access disabled, and a
  private endpoint.
- Microsoft Entra-only PostgreSQL Flexible Server and application database on
  a delegated subnet.
- Diagnostic settings for platform services and PostgreSQL CPU/storage alerts.

## Deployment inputs

No secret values are accepted. The required PostgreSQL administrator should be
a Microsoft Entra security group:

```powershell
az deployment group create `
  --resource-group <resource-group> `
  --template-file infra\main.bicep `
  --parameters namePrefix=darkfactory `
               environmentName=prod `
               location=eastus2 `
               postgresAdministratorObjectId=<entra-group-object-id> `
               postgresAdministratorPrincipalName=<entra-group-display-name> `
               imageTag=0.1.0 `
               alertEmailAddress=<operations-email>
```

The deployment does not push images. For a new environment, first run the
deployment with `deployApplications=false`, publish the separate web, API, and
worker images to the output registry, and run it again with
`deployApplications=true`. Use immutable image tags in production.

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
6. ACR and Key Vault have public network access disabled. Image pulls and vault
   access depend on VNet integration and the private DNS links.
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
- Private-only ACR means image publication must originate from a network with
  access to the VNet, or use an approved Azure-hosted build path that supports
  the registry network configuration.
