import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.port, env.host, () => {
  logger.info(`Glampro API listening on port ${env.port}`, { environment: env.nodeEnv });
});

/**
 * Drains in-flight requests, closes the database pool, then exits.
 * Forced shutdown after 10s in case a connection refuses to close.
 */
function shutdown(signal: string): void {
  logger.info(`Received ${signal} — shutting down`);

  server.close(() => {
    void prisma
      .$disconnect()
      .catch((error: unknown) => logger.error("Failed to disconnect from the database", { error }))
      .finally(() => process.exit(0));
  });

  setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
