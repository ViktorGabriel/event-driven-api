import { Queue, Worker, Job } from "bullmq";
import { redisConnection } from "./redis.js";
import { prisma } from "./prisma.js";

export const NOTIFICATION_QUEUE_NAME = "notification-dispatch";

export interface NotificationJobData {
  notificationId: string;
  batchId?: string | null;
  channel: "EMAIL" | "SMS" | "PUSH" | "WEBHOOK";
  recipient: string;
  subject?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

const priorityMap: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
};

export const notificationQueue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // keep failed jobs for 24 hours
      count: 5000,
    },
  },
});

export async function enqueueNotification(
  data: NotificationJobData,
  priority: string = "NORMAL",
  delay?: number,
) {
  const numericPriority = priorityMap[priority] ?? 3;
  return notificationQueue.add("dispatch-event", data, {
    priority: numericPriority,
    delay: delay && delay > 0 ? delay : undefined,
  });
}

export async function enqueueNotificationBulk(
  items: Array<{
    data: NotificationJobData;
    priority?: string;
    delay?: number;
  }>,
) {
  const bulkJobs = items.map((item) => ({
    name: "dispatch-event",
    data: item.data,
    opts: {
      priority: priorityMap[item.priority ?? "NORMAL"] ?? 3,
      delay: item.delay && item.delay > 0 ? item.delay : undefined,
    },
  }));

  return notificationQueue.addBulk(bulkJobs);
}

export function createNotificationWorker() {
  const worker = new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job: Job<NotificationJobData>) => {
      const { notificationId, channel, recipient } = job.data;

      // Mark as PROCESSING
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "PROCESSING",
          auditLogs: {
            create: {
              fromStatus: "QUEUED",
              toStatus: "PROCESSING",
              event: "DISPATCH_STARTED",
              details: { jobId: job.id, attempt: job.attemptsMade + 1 },
            },
          },
        },
      });

      // Simulation of delivery logic across channels
      // In production, delegate to AWS SES, Twilio, Firebase Cloud Messaging, or Axios Webhook
      if (recipient.includes("simulate-failure@fail.com")) {
        throw new Error("Simulated dispatch failure for testing retry mechanisms");
      }

      // Mark as DELIVERED
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
              details: { channel, recipient, jobId: job.id },
            },
          },
        },
      });

      // If part of a batch, increment successful counter
      if (job.data.batchId) {
        await prisma.batchDispatch.update({
          where: { id: job.data.batchId },
          data: {
            processedItems: { increment: 1 },
            successfulItems: { increment: 1 },
          },
        });
      }

      return { success: true, deliveredAt: new Date().toISOString() };
    },
    {
      connection: redisConnection,
      concurrency: 10,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { notificationId, batchId } = job.data;
    const isExhausted = job.attemptsMade >= (job.opts.attempts || 3);

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: isExhausted ? "FAILED" : "QUEUED",
        retryCount: job.attemptsMade,
        lastError: err.message,
        auditLogs: {
          create: {
            fromStatus: "PROCESSING",
            toStatus: isExhausted ? "FAILED" : "QUEUED",
            event: isExhausted ? "MAX_RETRIES_EXHAUSTED" : "RETRY_SCHEDULED",
            details: { error: err.message, attemptsMade: job.attemptsMade },
          },
        },
      },
    });

    if (batchId && isExhausted) {
      await prisma.batchDispatch.update({
        where: { id: batchId },
        data: {
          processedItems: { increment: 1 },
          failedItems: { increment: 1 },
        },
      });
    }
  });

  return worker;
}
