using './main.bicep'

param namePrefix = 'darkfactory'
param environmentName = 'demo'
param location = 'eastus2'
param postgresAdministratorObjectId = '<entra-group-object-id>'
param postgresAdministratorPrincipalName = '<entra-group-display-name>'

// Demo-only opt-in for authenticated image publication from GitHub-hosted runners.
param containerRegistryPublicNetworkAccessEnabled = true
param deployApplications = false
