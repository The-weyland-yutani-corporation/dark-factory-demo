import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Tracer,
} from "@opentelemetry/api";

export interface Logger {
  debug(message: string, attributes?: Readonly<Record<string, unknown>>): void;
  info(message: string, attributes?: Readonly<Record<string, unknown>>): void;
  warn(message: string, attributes?: Readonly<Record<string, unknown>>): void;
  error(message: string, attributes?: Readonly<Record<string, unknown>>): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const logPriorities: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function getTracer(serviceName: string): Tracer {
  return trace.getTracer(serviceName);
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  operation: () => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface ConsoleLoggerOptions {
  readonly minimumLevel?: LogLevel;
  readonly clock?: () => Date;
}

export function createConsoleLogger(
  service: string,
  options: ConsoleLoggerOptions = {},
): Logger {
  const minimumLevel = options.minimumLevel ?? "info";
  const clock = options.clock ?? (() => new Date());
  const write = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    attributes: Readonly<Record<string, unknown>> = {},
  ): void => {
    if (logPriorities[level] < logPriorities[minimumLevel]) {
      return;
    }
    const entry = JSON.stringify({
      timestamp: clock().toISOString(),
      level,
      service,
      message,
      ...attributes,
    });
    const output =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    output(entry);
  };

  return {
    debug: (message, attributes) => write("debug", message, attributes),
    info: (message, attributes) => write("info", message, attributes),
    warn: (message, attributes) => write("warn", message, attributes),
    error: (message, attributes) => write("error", message, attributes),
  };
}
