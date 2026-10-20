import { runMessageBatch } from "./services/message-worker.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
if (process.env.MESSAGING_ENABLED !== "true") {
  logger.info("Messaging worker disabled; no messages will be sent.");
} else {
  while (!stopping) {
    try {
      await runMessageBatch();
    } catch {
      logger.error("Messaging worker batch failed; check database and sender configuration.");
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
await prisma.$disconnect();
