import { buildApp } from "./app.js";
import { loadRuntimeConfig } from "./config.js";

const config = loadRuntimeConfig();
const app = buildApp({
  readinessEnabled: config.readinessEnabled,
  corsOrigin: config.corsOrigin,
  factoryDataMode: config.dataMode,
});

const close = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => {
  void close("SIGINT");
});
process.once("SIGTERM", () => {
  void close("SIGTERM");
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
