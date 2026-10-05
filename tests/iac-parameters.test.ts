import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const expectedValues = [
  /param namePrefix = 'darkfactory'/,
  /param environmentName = 'demo'/,
  /param location = 'eastus2'/,
  /param postgresAdministratorObjectId = '6ab9e067-26ba-469d-a1de-4b5a1571bd3f'/,
  /param postgresAdministratorPrincipalName = 'sharmave@MngEnvMCAP744360\.onmicrosoft\.com'/,
  /param tenantId = '1cf61a60-a877-46a7-86bc-a8f76b6ab441'/,
  /param applicationImageRepository = 'dark-factory'/,
  /param imageTag = '0\.1\.0'/,
  /param zoneRedundant = false/,
  /param postgresHighAvailability = false/,
  /param containerRegistryPublicNetworkAccessEnabled = true/,
];

describe("live demo deployment parameters", () => {
  it.each([
    "infra/main.demo.bicepparam",
    "infra/main.demo.applications.bicepparam",
  ])("contains the approved non-secret values in %s", async (file) => {
    const parameters = await readFile(file, "utf8");

    for (const expectedValue of expectedValues) {
      expect(parameters).toMatch(expectedValue);
    }
    expect(parameters).not.toMatch(
      /(password|clientSecret|githubToken|installationToken)\s*=/i,
    );
  });

  it("keeps the bootstrap and application deployment stages explicit", async () => {
    const [bootstrap, applications] = await Promise.all([
      readFile("infra/main.demo.bicepparam", "utf8"),
      readFile("infra/main.demo.applications.bicepparam", "utf8"),
    ]);

    expect(bootstrap).toMatch(/param deployApplications = false/);
    expect(applications).toMatch(/param deployApplications = true/);
  });

  it("documents the fixed deployment scope outside the resource-group template", async () => {
    const plan = await readFile(".azure/deployment-plan.md", "utf8");

    expect(plan).toContain("ad92e163-a85e-40cc-bb50-054b0b8197a8");
    expect(plan).toContain("rg-dark-factory-demo-eus2");
    expect(plan).toContain("infra/main.demo.applications.bicepparam");
  });
});
