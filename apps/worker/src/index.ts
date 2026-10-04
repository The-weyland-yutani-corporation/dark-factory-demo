import {
  createConsoleLogger,
  getTracer,
  withSpan,
} from "@dark-factory/observability";

const service = "dark-factory-worker";
const configuredLogLevel = process.env.LOG_LEVEL;
const logger = createConsoleLogger(service, {
  minimumLevel:
    configuredLogLevel === "debug" ||
    configuredLogLevel === "info" ||
    configuredLogLevel === "warn" ||
    configuredLogLevel === "error"
      ? configuredLogLevel
      : "info",
});
const tracer = getTracer(service);
const intervalMs = Number.parseInt(
  process.env.WORKER_POLL_INTERVAL_MS ?? "30000",
  10,
);

if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
  throw new Error(
    "WORKER_POLL_INTERVAL_MS must be an integer of at least 1000",
  );
}

async function poll(): Promise<void> {
  await withSpan(tracer, "worker.poll", async () => {
    logger.debug("worker poll completed", { intervalMs });
    await Promise.resolve();
  });
}

const timer = setInterval(() => {
  void poll().catch((error: unknown) => {
    logger.error("worker poll failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}, intervalMs);

logger.info("worker started", { intervalMs });

const stop = (signal: string): void => {
  clearInterval(timer);
  logger.info("worker stopped", { signal });
};

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

await poll();
