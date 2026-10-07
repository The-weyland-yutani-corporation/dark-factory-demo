param name string
param location string
param environmentId string
param identityId string
param identityClientId string
param registryServer string
param imageRepository string
param imageTag string
param targetPort int
param externalIngress bool
param minReplicas int
param maxReplicas int
param cpu string
param memory string
param environmentVariables array
param command array
param healthPath string = ''
param readinessPath string = ''
param tags object

var ingressConfiguration = externalIngress ? {
  allowInsecure: false
  external: true
  targetPort: targetPort
  transport: 'auto'
  traffic: [
    {
      latestRevision: true
      weight: 100
    }
  ]
} : null

var livenessProbes = empty(healthPath) ? [] : [
  {
    type: 'Liveness'
    httpGet: {
      path: healthPath
      port: targetPort
      scheme: 'HTTP'
    }
    initialDelaySeconds: 10
    periodSeconds: 30
    timeoutSeconds: 5
    failureThreshold: 3
  }
]

var readinessProbes = empty(readinessPath) ? [] : [
  {
    type: 'Readiness'
    httpGet: {
      path: readinessPath
      port: targetPort
      scheme: 'HTTP'
    }
    initialDelaySeconds: 5
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3
  }
]

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: ingressConfiguration
      registries: [
        {
          identity: identityId
          server: registryServer
        }
      ]
    }
    template: {
      containers: [
        {
          name: name
          image: '${registryServer}/${imageRepository}:${imageTag}'
          command: command
          env: concat(environmentVariables, [
            {
              name: 'AZURE_CLIENT_ID'
              value: identityClientId
            }
          ])
          probes: concat(livenessProbes, readinessProbes)
          resources: {
            cpu: json(cpu)
            memory: memory
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
    workloadProfileName: 'Consumption'
  }
}

output name string = app.name
output fqdn string = externalIngress ? app.properties.configuration.ingress.fqdn : ''
output url string = externalIngress ? 'https://${app.properties.configuration.ingress.fqdn}' : ''
