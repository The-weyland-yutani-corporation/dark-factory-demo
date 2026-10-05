import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

export interface DeduplicationStore {
  tryClaim(key: string, expiresAt: Date): Promise<boolean>;
  complete(key: string): Promise<void>;
  release(key: string): Promise<void>;
}

interface DeduplicationEntity {
  partitionKey: string;
  rowKey: string;
  state: string;
  expiresAt: string;
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { statusCode?: unknown };
  return typeof candidate.statusCode === "number"
    ? candidate.statusCode
    : undefined;
}

export class TableDeduplicationStore implements DeduplicationStore {
  public constructor(private readonly client: TableClient) {}

  public static fromEnvironment(): TableDeduplicationStore {
    const endpoint = process.env.AZURE_STORAGE_TABLE_ENDPOINT;
    const tableName = process.env.ALERT_DEDUPLICATION_TABLE ?? "alertdedupe";
    if (!endpoint) {
      throw new Error("AZURE_STORAGE_TABLE_ENDPOINT is required.");
    }
    return new TableDeduplicationStore(
      new TableClient(endpoint, tableName, new DefaultAzureCredential()),
    );
  }

  public async tryClaim(key: string, expiresAt: Date): Promise<boolean> {
    const entity: DeduplicationEntity = {
      partitionKey: "azure-monitor",
      rowKey: key,
      state: "processing",
      expiresAt: expiresAt.toISOString(),
    };
    try {
      await this.client.createEntity(entity);
      return true;
    } catch (error) {
      if (statusCode(error) === 409) {
        const existing = await this.client.getEntity<DeduplicationEntity>(
          "azure-monitor",
          key,
        );
        if (new Date(existing.expiresAt).getTime() > Date.now()) return false;
        try {
          await this.client.deleteEntity("azure-monitor", key, {
            etag: existing.etag,
          });
          await this.client.createEntity(entity);
          return true;
        } catch (replacementError) {
          if ([404, 409, 412].includes(statusCode(replacementError) ?? 0)) {
            return false;
          }
          throw replacementError;
        }
      }
      throw error;
    }
  }

  public async complete(key: string): Promise<void> {
    await this.client.updateEntity(
      {
        partitionKey: "azure-monitor",
        rowKey: key,
        state: "dispatched",
      },
      "Merge",
    );
  }

  public async release(key: string): Promise<void> {
    try {
      await this.client.deleteEntity("azure-monitor", key);
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
  }
}
