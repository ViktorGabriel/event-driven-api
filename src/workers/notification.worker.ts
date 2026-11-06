import { Worker, Job } from "bullmq";
import { redisConnection } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import {
  NOTIFICATION_QUEUE_NAME,
  NotificationJobData,
  sendToDeadLetterQueue,
} from "../lib/queue.js";
import { dispatchByChannel } from "../adapters/index.js";

export interface WorkerOptions {
  concurrency?: number;
}

export function createNotificationWorker(options: WorkerOptions = {}) {
  const concurrency = options.concurrency ?? 10;

  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job: Job<NotificationJobData>) => {
      const { notificationId, channel, recipient } = job.data;

      // 1. Mark as PROCESSING in database
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "PROCESSING",
          auditLogs: {
            create: {
              fromStatus: "QUEUED",
              toStatus: "PROCESSING",
              event: "DISPATCH_STARTED",
              details: {
                jobId: job.id,
                channel,
                recipient,
                attempt: job.attemptsMade + 1,
              },
            },
          },
        },
      });

      // 2. Dispatch via channel adapter
      const dispatchResult = await dispatchByChannel(job.data);

      // 3. Mark as DELIVERED in database
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          auditLogs: {
            create: {
              fromStatus: "PROCESSING",
              toStatus: "DELIVERED",
              event: "DISPATCH_SUCCESS",
              details: {
                channel,
                recipient,
                jobId: job.id,
                result: dispatchResult,
              },
            },
          },
        },
      });

      // 4. Update batch metrics if part of a batch
      if (job.data.batchId) {
        await prisma.batchDispatch.update({
          where: { id: job.data.batchId },
          data: {
            processedItems: { increment: 1 },
            successfulItems: { increment: 1 },
          },
        });
      }

      return {
        success: true,
        deliveredAt: new Date().toISOString(),
        dispatchResult,
      };
    },
    {
      connection: redisConnection,
      concurrency,
    },
  );

  // Failure and Resilience Handler (Retry vs DLQ)
  worker.on("failed", async (job, err) => {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 3;
    const isExhausted = job.attemptsMade >= maxAttempts;

    if (isExhausted) {
      // Retries exhausted: Route immediately to Dead Letter Queue (DLQ)
      await sendToDeadLetterQueue(job, err);
      console.warn(
        `[Worker DLQ] Notification '${job.data.notificationId}' failed after ${job.attemptsMade} attempts. Routed to Dead Letter Queue. Error: ${err.message}`,
      );
    } else {
      // Temporary failure: Schedule next retry with exponential backoff
      await prisma.notification.update({
        where: { id: job.data.notificationId },
        data: {
          status: "QUEUED",
          retryCount: job.attemptsMade,
          lastError: err.message,
          auditLogs: {
            create: {
              fromStatus: "PROCESSING",
              toStatus: "QUEUED",
              event: "RETRY_SCHEDULED",
              details: {
                attempt: job.attemptsMade,
                maxAttempts,
                error: err.message,
              },
            },
          },
        },
      });

      console.info(
        `[Worker Retry] Notification '${job.data.notificationId}' attempt ${job.attemptsMade}/${maxAttempts} failed. Retrying... Error: ${err.message}`,
      );
    }
  });

  return worker;
}

// Standalone Worker Process Runner
export async function startStandaloneWorker() {
  console.log("⚡ Starting standalone Notification Worker...");
  const worker = createNotificationWorker({ concurrency: 15 });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Shutting down worker gracefully...`);
    try {
      await worker.close();
      await redisConnection.quit();
      await prisma.$disconnect();
      console.log("Worker process stopped cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("Error stopping worker:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("🚀 Standalone Notification Worker active and listening for events.");
}

// Auto-run if executed directly as entrypoint
const isDirectExecution =
  process.argv[1]?.endsWith("notification.worker.ts") ||
  process.argv[1]?.endsWith("notification.worker.js");

if (isDirectExecution) {
  startStandaloneWorker();
}
