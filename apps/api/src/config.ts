export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly readinessEnabled: boolean;
  readonly corsOrigin: string | false;
  readonly dataMode: "demo" | "production";
}

export interface ConfigValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly config?: RuntimeConfig;
}

function parseBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
  errors: string[],
): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  errors.push(`${name} must be true or false`);
  return fallback;
}

export function validateRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ConfigValidation {
  const errors: string[] = [];
  const host = environment.API_HOST?.trim() || "0.0.0.0";
  const port = Number(environment.API_PORT ?? "3000");
  const readinessEnabled = parseBoolean(
    environment.READINESS_ENABLED,
    "READINESS_ENABLED",
    true,
    errors,
  );
  const corsValue = environment.CORS_ORIGIN?.trim() ?? "http://localhost:5173";
  const corsOrigin = corsValue === "false" ? false : corsValue;
  const dataMode = environment.FACTORY_DATA_MODE ?? "demo";

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    errors.push("API_PORT must be an integer between 1 and 65535");
  }
  if (corsOrigin !== false) {
    try {
      const parsed = new URL(corsOrigin);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.push("CORS_ORIGIN must use http or https");
      }
    } catch {
      errors.push("CORS_ORIGIN must be a valid URL or false");
    }
  }
  if (dataMode !== "demo" && dataMode !== "production") {
    errors.push("FACTORY_DATA_MODE must be demo or production");
  }

  return errors.length
    ? { valid: false, errors }
    : {
        valid: true,
        errors,
        config: {
          host,
          port,
          readinessEnabled,
          corsOrigin,
          dataMode: dataMode as "demo" | "production",
        },
      };
}

export function loadRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfig {
  const validation = validateRuntimeConfig(environment);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid configuration: ${validation.errors.join("; ")}`);
  }
  return validation.config;
}
