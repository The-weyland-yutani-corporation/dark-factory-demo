param baseName string
param postgresServerId string
param alertEmailAddress string
param alertAdapterFunctionAppId string
param alertAdapterFunctionUrl string
@secure()
param alertAdapterFunctionKey string
param tags object

var emailAlertsEnabled = !empty(alertEmailAddress)
var alertAdapterEnabled = !empty(alertAdapterFunctionKey)
var alertsEnabled = emailAlertsEnabled || alertAdapterEnabled

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${baseName}-ag'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    groupShortName: take(replace(baseName, '-', ''), 12)
    emailReceivers: emailAlertsEnabled ? [
      {
        name: 'operations'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ] : []
    azureFunctionReceivers: alertAdapterEnabled ? [
      {
        name: 'dark-factory-alert-adapter'
        functionAppResourceId: alertAdapterFunctionAppId
        functionName: 'azure-monitor-alert'
        httpTriggerUrl: '${alertAdapterFunctionUrl}?code=${alertAdapterFunctionKey}'
        useCommonAlertSchema: true
      }
    ] : []
  }
}

resource postgresCpuAlert 'Microsoft.Insights/metricAlerts@2026-01-01' = {
  name: '${baseName}-postgres-high-cpu'
  location: 'global'
  tags: tags
  properties: {
    description: 'PostgreSQL average CPU is above 80 percent for 15 minutes.'
    severity: 2
    enabled: alertsEnabled
    scopes: [
      postgresServerId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HighCpu'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'cpu_percent'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
        }
      ]
    }
    actions: alertsEnabled ? [
      {
        actionGroupId: actionGroup.id
      }
    ] : []
  }
}

resource postgresStorageAlert 'Microsoft.Insights/metricAlerts@2026-01-01' = {
  name: '${baseName}-postgres-high-storage'
  location: 'global'
  tags: tags
  properties: {
    description: 'PostgreSQL storage consumption is above 85 percent for 15 minutes.'
    severity: 1
    enabled: alertsEnabled
    scopes: [
      postgresServerId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HighStorage'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'storage_percent'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          operator: 'GreaterThan'
          threshold: 85
          timeAggregation: 'Average'
        }
      ]
    }
    actions: alertsEnabled ? [
      {
        actionGroupId: actionGroup.id
      }
    ] : []
  }
}

output actionGroupId string = actionGroup.id
output alertsEnabled bool = alertsEnabled
output alertAdapterEnabled bool = alertAdapterEnabled
