using './main.bicep'

param namePrefix = 'darkfactory'
param environmentName = 'demo'
param location = 'eastus2'
param postgresAdministratorObjectId = '6ab9e067-26ba-469d-a1de-4b5a1571bd3f'
param postgresAdministratorPrincipalName = 'sharmave@MngEnvMCAP744360.onmicrosoft.com'
param tenantId = '1cf61a60-a877-46a7-86bc-a8f76b6ab441'
param applicationImageRepository = 'dark-factory'
param imageTag = '0.1.0'
param zoneRedundant = false
param postgresHighAvailability = false

// Demo-only opt-in for authenticated image publication from GitHub-hosted runners.
param containerRegistryPublicNetworkAccessEnabled = true
param deployApplications = true
