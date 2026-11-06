import { Queue, Job } from "bullmq";
import { redisConnection } from "./redis.js";
import { prisma } from "./prisma.js";

export const NOTIFICATION_QUEUE_NAME = "notification-dispatch";
export const NOTIFICATION_DLQ_NAME = "notification-dlq";

export interface NotificationJobData {
  notificationId: string;
  batchId?: string | null;
  channel: "EMAIL" | "SMS" | "PUSH" | "WEBHOOK";
  recipient: string;
  subject?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface DlqJobData extends NotificationJobData {
  originalJobId?: string;
  failedAt: string;
  attemptsMade: number;
  lastError: string;
}

const priorityMap: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
};

// Main Dispatch Queue
export const notificationQueue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
      count: 5000,
    },
  },
});

// Dead Letter Queue (DLQ) for permanently failed or retry-exhausted events
export const notificationDlq = new Queue<DlqJobData>(NOTIFICATION_DLQ_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
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

export async function sendToDeadLetterQueue(
  job: Job<NotificationJobData>,
  error: Error,
): Promise<Job<DlqJobData>> {
  const dlqData: DlqJobData = {
    ...job.data,
    originalJobId: job.id,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
    lastError: error.message,
  };

  const dlqJob = await notificationDlq.add("dead-letter-event", dlqData, {
    removeOnComplete: false,
    removeOnFail: false,
  });

  // Update notification state in DB with DLQ audit trail
  await prisma.notification.update({
    where: { id: job.data.notificationId },
    data: {
      status: "FAILED",
      retryCount: job.attemptsMade,
      lastError: error.message,
      auditLogs: {
        create: {
          fromStatus: "PROCESSING",
          toStatus: "FAILED",
          event: "MOVED_TO_DLQ",
          details: {
            dlqJobId: dlqJob.id,
            attemptsMade: job.attemptsMade,
            error: error.message,
          },
        },
      },
    },
  });

  // If part of a batch, increment failed items
  if (job.data.batchId) {
    await prisma.batchDispatch.update({
      where: { id: job.data.batchId },
      data: {
        processedItems: { increment: 1 },
        failedItems: { increment: 1 },
      },
    });
  }

  return dlqJob;
}

export async function replayDlqJob(dlqJobId: string): Promise<Job<NotificationJobData>> {
  const dlqJob = await notificationDlq.getJob(dlqJobId);
  if (!dlqJob) {
    throw new Error(`DLQ Job with ID '${dlqJobId}' not found`);
  }

  const {
    originalJobId: _,
    failedAt: __,
    attemptsMade: ___,
    lastError: ____,
    ...notificationData
  } = dlqJob.data;

  // Re-enqueue into main queue
  const replayedJob = await notificationQueue.add("dispatch-event", notificationData, {
    priority: 2, // High priority for replayed items
  });

  // Remove from DLQ
  await dlqJob.remove();

  // Audit trail
  await prisma.notification.update({
    where: { id: notificationData.notificationId },
    data: {
      status: "QUEUED",
      auditLogs: {
        create: {
          fromStatus: "FAILED",
          toStatus: "QUEUED",
          event: "REPLAYED_FROM_DLQ",
          details: { oldDlqJobId: dlqJobId, newJobId: replayedJob.id },
        },
      },
    },
  });

  return replayedJob;
}
