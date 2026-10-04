import {
  loadRuntimeConfig,
  validateRuntimeConfig,
} from "../apps/api/src/config.js";
import { describe, expect, it } from "vitest";

describe("runtime configuration", () => {
  it("loads safe local defaults", () => {
    expect(loadRuntimeConfig({})).toEqual({
      host: "0.0.0.0",
      port: 3000,
      readinessEnabled: true,
      corsOrigin: "http://localhost:5173",
      dataMode: "demo",
    });
  });

  it("aggregates invalid values without exposing environment contents", () => {
    const result = validateRuntimeConfig({
      API_PORT: "70000",
      READINESS_ENABLED: "sometimes",
      CORS_ORIGIN: "file:///secret",
      FACTORY_DATA_MODE: "live",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "READINESS_ENABLED must be true or false",
      "API_PORT must be an integer between 1 and 65535",
      "CORS_ORIGIN must use http or https",
      "FACTORY_DATA_MODE must be demo or production",
    ]);
    expect(() => loadRuntimeConfig({ API_PORT: "not-a-number" })).toThrowError(
      "Invalid configuration",
    );
  });
});
