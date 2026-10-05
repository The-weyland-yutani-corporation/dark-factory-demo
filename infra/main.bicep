targetScope = 'resourceGroup'

@description('Short application name used in resource names.')
@minLength(2)
@maxLength(16)
param namePrefix string

@description('Deployment environment name, for example dev, test, or prod.')
@minLength(2)
@maxLength(12)
param environmentName string

@description('Azure region for all regional resources.')
param location string

@description('Microsoft Entra object ID for the PostgreSQL administrator. Prefer a security group.')
param postgresAdministratorObjectId string

@description('Display name of the Microsoft Entra PostgreSQL administrator.')
param postgresAdministratorPrincipalName string

@description('Microsoft Entra tenant ID containing the PostgreSQL administrator and managed identities.')
param tenantId string = tenant().tenantId

@description('Email receiver for operational alerts. Leave empty to deploy alerts disabled.')
param alertEmailAddress string = ''

@description('Container image repository shared by the combined web/API application and worker.')
param applicationImageRepository string = 'dark-factory'

@description('Immutable image tag or digest-compatible tag shared by the application images.')
param imageTag string = '0.1.0'

@description('Deploy the web, API, and worker after their images exist in the registry.')
param deployApplications bool = true

@description('Whether the Container Apps environment is zone redundant. Requires regional support.')
param zoneRedundant bool = false

@description('Whether PostgreSQL zone-redundant high availability is enabled. Requires regional support.')
param postgresHighAvailability bool = false

@description('PostgreSQL compute SKU.')
param postgresSkuName string = 'Standard_D2ds_v5'

@description('PostgreSQL storage size in GiB.')
@minValue(32)
param postgresStorageSizeGiB int = 128

@description('Virtual network address space.')
param vnetAddressPrefix string = '10.40.0.0/16'

@description('Container Apps infrastructure subnet prefix. This subnet must remain dedicated.')
param containerAppsSubnetPrefix string = '10.40.0.0/23'

@description('PostgreSQL delegated subnet prefix. This subnet must remain dedicated.')
param postgresSubnetPrefix string = '10.40.2.0/24'

@description('Private endpoint subnet prefix.')
param privateEndpointsSubnetPrefix string = '10.40.3.0/24'

@description('Tags applied to all resources.')
param tags object = {}

var normalizedPrefix = toLower(replace(namePrefix, '-', ''))
var normalizedEnvironment = toLower(replace(environmentName, '-', ''))
var resourceToken = take(uniqueString(subscription().id, resourceGroup().id, namePrefix, environmentName), 8)
var baseName = toLower('${namePrefix}-${environmentName}')
var containerAppBaseName = take(baseName, 24)
var commonTags = union(tags, {
  application: namePrefix
  environment: environmentName
  managedBy: 'bicep'
})
var registryName = take('${normalizedPrefix}${normalizedEnvironment}${resourceToken}', 50)
var keyVaultName = take('${normalizedPrefix}-${environmentName}-${resourceToken}', 24)
var postgresName = take('${normalizedPrefix}-${environmentName}-${resourceToken}-pg', 63)

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    name: '${baseName}-vnet'
    location: location
    vnetAddressPrefix: vnetAddressPrefix
    containerAppsSubnetPrefix: containerAppsSubnetPrefix
    postgresSubnetPrefix: postgresSubnetPrefix
    privateEndpointsSubnetPrefix: privateEndpointsSubnetPrefix
    postgresPrivateDnsZoneName: '${postgresName}.private.postgres.database.azure.com'
    tags: commonTags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    baseName: baseName
    location: location
    telemetryPrincipalIds: [
      identities.outputs.appPrincipalId
      identities.outputs.workerPrincipalId
    ]
    tags: commonTags
  }
}

module identities 'modules/identities.bicep' = {
  name: 'identities'
  params: {
    baseName: baseName
    location: location
    tags: commonTags
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    name: registryName
    location: location
    privateEndpointSubnetId: network.outputs.privateEndpointsSubnetId
    privateDnsZoneId: network.outputs.acrPrivateDnsZoneId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    pullIdentityPrincipalIds: [
      identities.outputs.appPrincipalId
      identities.outputs.workerPrincipalId
    ]
    tags: commonTags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault'
  params: {
    name: keyVaultName
    location: location
    tenantId: tenantId
    privateEndpointSubnetId: network.outputs.privateEndpointsSubnetId
    privateDnsZoneId: network.outputs.keyVaultPrivateDnsZoneId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    secretReaderPrincipalIds: [
      identities.outputs.appPrincipalId
      identities.outputs.workerPrincipalId
    ]
    tags: commonTags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    serverName: postgresName
    databaseName: 'darkfactory'
    location: location
    delegatedSubnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: network.outputs.postgresPrivateDnsZoneId
    tenantId: tenantId
    administratorObjectId: postgresAdministratorObjectId
    administratorPrincipalName: postgresAdministratorPrincipalName
    skuName: postgresSkuName
    storageSizeGiB: postgresStorageSizeGiB
    highAvailabilityEnabled: postgresHighAvailability
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    tags: commonTags
  }
}

module containerEnvironment 'modules/container-environment.bicep' = {
  name: 'containerEnvironment'
  params: {
    name: '${baseName}-cae'
    location: location
    infrastructureSubnetId: network.outputs.containerAppsSubnetId
    zoneRedundant: zoneRedundant
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    tags: commonTags
  }
}

var sharedEnvironmentVariables = [
  {
    name: 'APP_VERSION'
    value: imageTag
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: monitoring.outputs.applicationInsightsConnectionString
  }
  {
    name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING'
    value: 'Authorization=AAD'
  }
  {
    name: 'POSTGRES_HOST'
    value: postgres.outputs.serverFqdn
  }
  {
    name: 'POSTGRES_DATABASE'
    value: postgres.outputs.databaseName
  }
  {
    name: 'POSTGRES_PORT'
    value: '5432'
  }
  {
    name: 'POSTGRES_SSL_MODE'
    value: 'require'
  }
]

module app 'modules/container-app.bicep' = if (deployApplications) {
  name: 'application'
  params: {
    name: '${containerAppBaseName}-app'
    location: location
    environmentId: containerEnvironment.outputs.environmentId
    identityId: identities.outputs.appIdentityId
    identityClientId: identities.outputs.appClientId
    registryServer: registry.outputs.loginServer
    imageRepository: applicationImageRepository
    imageTag: imageTag
    targetPort: 3000
    externalIngress: true
    minReplicas: 1
    maxReplicas: 10
    cpu: '0.5'
    memory: '1Gi'
    command: [
      'node'
      'apps/api/dist/index.js'
    ]
    environmentVariables: concat(sharedEnvironmentVariables, [
      {
        name: 'API_HOST'
        value: '0.0.0.0'
      }
      {
        name: 'API_PORT'
        value: '3000'
      }
      {
        name: 'READINESS_ENABLED'
        value: 'true'
      }
    ])
    healthPath: '/healthz'
    readinessPath: '/readyz'
    tags: commonTags
  }
}

module worker 'modules/container-app.bicep' = if (deployApplications) {
  name: 'workerApp'
  params: {
    name: '${containerAppBaseName}-worker'
    location: location
    environmentId: containerEnvironment.outputs.environmentId
    identityId: identities.outputs.workerIdentityId
    identityClientId: identities.outputs.workerClientId
    registryServer: registry.outputs.loginServer
    imageRepository: applicationImageRepository
    imageTag: imageTag
    targetPort: 3000
    externalIngress: false
    minReplicas: 1
    maxReplicas: 3
    cpu: '0.5'
    memory: '1Gi'
    command: [
      'node'
      'apps/worker/dist/index.js'
    ]
    environmentVariables: concat(sharedEnvironmentVariables, [
      {
        name: 'WORKER_POLL_INTERVAL_MS'
        value: '30000'
      }
    ])
    tags: commonTags
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    baseName: baseName
    postgresServerId: postgres.outputs.serverId
    alertEmailAddress: alertEmailAddress
    tags: commonTags
  }
}

output containerRegistryLoginServer string = registry.outputs.loginServer
output keyVaultUri string = keyVault.outputs.vaultUri
output postgresServerFqdn string = postgres.outputs.serverFqdn
output postgresDatabaseName string = postgres.outputs.databaseName
output applicationInsightsName string = monitoring.outputs.applicationInsightsName
output logAnalyticsWorkspaceName string = monitoring.outputs.logAnalyticsWorkspaceName
output applicationUrl string = app.?outputs.url ?? ''
output applicationName string = app.?outputs.name ?? ''
output workerName string = worker.?outputs.name ?? ''
output applicationIdentityClientId string = identities.outputs.appClientId
output workerIdentityClientId string = identities.outputs.workerClientId
