targetScope = 'subscription'

@description('Resource group that contains the complete dark factory environment.')
param resourceGroupName string

@description('Azure region for the resource group and all regional resources.')
param location string

@description('Short application name used in resource names.')
param namePrefix string

@description('Deployment environment name, for example dev, test, or prod.')
param environmentName string

@description('Microsoft Entra object ID for the PostgreSQL administrator.')
param postgresAdministratorObjectId string

@description('Display name of the Microsoft Entra PostgreSQL administrator.')
param postgresAdministratorPrincipalName string

@description('Microsoft Entra tenant ID containing the administrator and managed identities.')
param tenantId string = tenant().tenantId

@description('Email receiver for operational alerts. Leave empty to deploy alerts disabled.')
param alertEmailAddress string = ''

@description('Container image repository shared by the application and worker.')
param applicationImageRepository string = 'dark-factory'

@description('Immutable image tag shared by the application images.')
param imageTag string = '0.1.0'

@description('Deploy the application and worker after their image exists.')
param deployApplications bool = false

@description('Allow authenticated ACR access over its public endpoint.')
param containerRegistryPublicNetworkAccessEnabled bool = false

@description('Whether the Container Apps environment is zone redundant.')
param zoneRedundant bool = false

@description('Whether PostgreSQL zone-redundant high availability is enabled.')
param postgresHighAvailability bool = false

@description('PostgreSQL compute SKU.')
param postgresSkuName string = 'Standard_D2ds_v5'

@description('PostgreSQL storage size in GiB.')
param postgresStorageSizeGiB int = 128

@description('Virtual network address space.')
param vnetAddressPrefix string = '10.40.0.0/16'

@description('Container Apps infrastructure subnet prefix.')
param containerAppsSubnetPrefix string = '10.40.0.0/23'

@description('PostgreSQL delegated subnet prefix.')
param postgresSubnetPrefix string = '10.40.2.0/24'

@description('Private endpoint subnet prefix.')
param privateEndpointsSubnetPrefix string = '10.40.3.0/24'

@description('Azure Functions integration subnet prefix.')
param functionsSubnetPrefix string = '10.40.4.0/24'

@description('GitHub App private-key secret name. The value is supplied after deployment.')
param githubAppPrivateKeySecretName string = 'dark-factory-mage-private-key'

@description('Function host key for Azure Monitor alerts. Leave empty during bootstrap.')
@secure()
param alertAdapterFunctionKey string = ''

@description('Tags applied to the resource group and deployed resources.')
param tags object = {}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module environment './main.bicep' = {
  name: 'darkFactoryEnvironment'
  scope: resourceGroup
  params: {
    namePrefix: namePrefix
    environmentName: environmentName
    location: location
    postgresAdministratorObjectId: postgresAdministratorObjectId
    postgresAdministratorPrincipalName: postgresAdministratorPrincipalName
    tenantId: tenantId
    alertEmailAddress: alertEmailAddress
    applicationImageRepository: applicationImageRepository
    imageTag: imageTag
    deployApplications: deployApplications
    containerRegistryPublicNetworkAccessEnabled: containerRegistryPublicNetworkAccessEnabled
    zoneRedundant: zoneRedundant
    postgresHighAvailability: postgresHighAvailability
    postgresSkuName: postgresSkuName
    postgresStorageSizeGiB: postgresStorageSizeGiB
    vnetAddressPrefix: vnetAddressPrefix
    containerAppsSubnetPrefix: containerAppsSubnetPrefix
    postgresSubnetPrefix: postgresSubnetPrefix
    privateEndpointsSubnetPrefix: privateEndpointsSubnetPrefix
    functionsSubnetPrefix: functionsSubnetPrefix
    githubAppPrivateKeySecretName: githubAppPrivateKeySecretName
    alertAdapterFunctionKey: alertAdapterFunctionKey
    tags: tags
  }
}

output resourceGroupId string = resourceGroup.id
output resourceGroupName string = resourceGroup.name
output containerRegistryLoginServer string = environment.outputs.containerRegistryLoginServer
output applicationUrl string = environment.outputs.applicationUrl
output applicationName string = environment.outputs.applicationName
output workerName string = environment.outputs.workerName
output alertAdapterFunctionName string = environment.outputs.alertAdapterFunctionName
