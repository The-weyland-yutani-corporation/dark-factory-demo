export interface CommonAlertSchema {
  schemaId?: string;
  data?: {
    essentials?: {
      alertId?: string;
      alertRule?: string;
      severity?: string;
      signalType?: string;
      monitorCondition?: string;
      monitoringService?: string;
      alertTargetIDs?: string[];
      configurationItems?: string[];
      originAlertId?: string;
      firedDateTime?: string;
      resolvedDateTime?: string;
      description?: string;
      essentialsVersion?: string;
      alertContextVersion?: string;
      correlationId?: string;
    };
    alertContext?: unknown;
    customProperties?: Record<string, unknown>;
  };
}

export interface NormalizedAlert {
  schemaVersion: "1.0";
  source: "azure-monitor";
  eventType: "azure-monitor-alert" | "container-apps-alert";
  alertId: string;
  rule: {
    name: string;
    id?: string;
  };
  correlationId: string;
  status: string;
  severity: {
    azure: string;
    normalized: "critical" | "high" | "medium" | "low" | "informational";
    priority: number;
  };
  signalType?: string;
  monitoringService?: string;
  firedAt?: string;
  resolvedAt?: string;
  description?: string;
  targetResourceIds: string[];
  configurationItems: string[];
  commitSha?: string;
  containerAppsRevision?: string;
}
