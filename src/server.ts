import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { createNotificationWorker } from "./lib/queue.js";
import { redisConnection } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";

async function bootstrap() {
  const app = await buildApp();
  const worker = createNotificationWorker();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Starting graceful shutdown...`);
    try {
      await worker.close();
      await app.close();
      await redisConnection.quit();
      await prisma.$disconnect();
      app.log.info("Graceful shutdown completed successfully.");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(
      `🚀 Notification & Dispatch Engine listening on http://${env.HOST}:${env.PORT}`,
    );
    console.log(
      `📑 OpenAPI / Swagger UI available at http://${env.HOST}:${env.PORT}/docs`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
