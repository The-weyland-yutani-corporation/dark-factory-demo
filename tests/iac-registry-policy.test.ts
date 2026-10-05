import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("container registry network policy", () => {
  it("defaults public access off and explicitly passes the opt-in to the module", async () => {
    const main = await readFile("infra/main.bicep", "utf8");

    expect(main).toMatch(
      /param containerRegistryPublicNetworkAccessEnabled bool = false/,
    );
    expect(main).toMatch(
      /publicNetworkAccessEnabled:\s*containerRegistryPublicNetworkAccessEnabled/,
    );
  });

  it("keeps authenticated private access controls when public access is enabled", async () => {
    const registry = await readFile("infra/modules/registry.bicep", "utf8");

    expect(registry).toMatch(/adminUserEnabled:\s*false/);
    expect(registry).toMatch(/anonymousPullEnabled:\s*false/);
    expect(registry).toMatch(
      /publicNetworkAccess:\s*publicNetworkAccessEnabled \? 'Enabled' : 'Disabled'/,
    );
    expect(registry).toMatch(
      /defaultAction:\s*publicNetworkAccessEnabled \? 'Allow' : 'Deny'/,
    );
    expect(registry).toMatch(
      /resource privateEndpoint 'Microsoft\.Network\/privateEndpoints@/,
    );
    expect(registry).toMatch(
      /resource privateDnsZoneGroup 'Microsoft\.Network\/privateEndpoints\/privateDnsZoneGroups@/,
    );
  });

  it("documents the explicit demo opt-in without weakening application deployment defaults", async () => {
    const parameters = await readFile("infra/main.demo.bicepparam", "utf8");

    expect(parameters).toMatch(
      /param containerRegistryPublicNetworkAccessEnabled = true/,
    );
    expect(parameters).toMatch(/param deployApplications = false/);
  });
});
