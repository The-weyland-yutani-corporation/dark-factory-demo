param name string
param location string
param vnetAddressPrefix string
param containerAppsSubnetPrefix string
param postgresSubnetPrefix string
param privateEndpointsSubnetPrefix string
param postgresPrivateDnsZoneName string
param tags object

resource vnet 'Microsoft.Network/virtualNetworks@2025-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'snet-container-apps'
        properties: {
          addressPrefix: containerAppsSubnetPrefix
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-postgresql'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [
            {
              name: 'Microsoft.DBforPostgreSQL.flexibleServers'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: privateEndpointsSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2025-07-01' existing = {
  parent: vnet
  name: 'snet-container-apps'
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2025-07-01' existing = {
  parent: vnet
  name: 'snet-postgresql'
}

resource privateEndpointsSubnet 'Microsoft.Network/virtualNetworks/subnets@2025-07-01' existing = {
  parent: vnet
  name: 'snet-private-endpoints'
}

resource acrPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.azurecr.io'
  location: 'global'
  tags: tags
}

resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

resource postgresPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: postgresPrivateDnsZoneName
  location: 'global'
  tags: tags
}

resource acrDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: acrPrivateDnsZone
  name: '${name}-acr-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource keyVaultDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: keyVaultPrivateDnsZone
  name: '${name}-kv-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresPrivateDnsZone
  name: '${name}-postgres-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

output vnetId string = vnet.id
output containerAppsSubnetId string = containerAppsSubnet.id
output postgresSubnetId string = postgresSubnet.id
output privateEndpointsSubnetId string = privateEndpointsSubnet.id
output acrPrivateDnsZoneId string = acrPrivateDnsZone.id
output keyVaultPrivateDnsZoneId string = keyVaultPrivateDnsZone.id
output postgresPrivateDnsZoneId string = postgresPrivateDnsZone.id
