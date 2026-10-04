param serverName string
param databaseName string
param location string
param delegatedSubnetId string
param privateDnsZoneId string
param tenantId string
param administratorObjectId string
param administratorPrincipalName string
param skuName string
param storageSizeGiB int
param highAvailabilityEnabled bool
param logAnalyticsWorkspaceId string
param tags object

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: 'GeneralPurpose'
  }
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenantId
    }
    backup: {
      backupRetentionDays: 14
      geoRedundantBackup: 'Disabled'
    }
    dataEncryption: {
      type: 'SystemManaged'
    }
    highAvailability: {
      mode: highAvailabilityEnabled ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: storageSizeGiB
    }
  }
}

resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = {
  parent: server
  name: administratorObjectId
  properties: {
    principalName: administratorPrincipalName
    principalType: 'Group'
    tenantId: tenantId
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource requireSecureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    source: 'user-override'
    value: 'on'
  }
}

#disable-next-line use-recent-api-versions
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'send-to-log-analytics'
  scope: server
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output serverId string = server.id
output serverFqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
