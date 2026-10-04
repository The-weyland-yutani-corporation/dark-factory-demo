param baseName string
param location string
param telemetryPrincipalIds array
param tags object

var monitoringMetricsPublisherRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '3913510d-42f4-4e42-8a64-420c390055eb'
)

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: '${baseName}-law'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-appi'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableLocalAuth: true
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource telemetryAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in telemetryPrincipalIds: {
    name: guid(applicationInsights.id, principalId, monitoringMetricsPublisherRoleDefinitionId)
    scope: applicationInsights
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: monitoringMetricsPublisherRoleDefinitionId
    }
  }
]

output logAnalyticsWorkspaceId string = workspace.id
output logAnalyticsWorkspaceName string = workspace.name
output applicationInsightsName string = applicationInsights.name
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString
