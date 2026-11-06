import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNotificationWorker } from "./notification.worker.js";
import { prisma } from "../lib/prisma.js";
import * as adapters from "../adapters/index.js";
import * as queueLib from "../lib/queue.js";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    notification: {
      update: vi.fn(),
    },
    batchDispatch: {
      update: vi.fn(),
    },
  },
}));

vi.mock("../lib/redis.js", () => ({
  redisConnection: {
    on: vi.fn(),
  },
}));

vi.mock("../adapters/index.js", () => ({
  dispatchByChannel: vi.fn(),
}));

vi.mock("../lib/queue.js", () => ({
  NOTIFICATION_QUEUE_NAME: "notification-dispatch",
  sendToDeadLetterQueue: vi.fn(),
}));

describe("Notification Worker Unit & Resilience Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should process job successfully, dispatch via adapter and update DB to DELIVERED", async () => {
    const worker = createNotificationWorker();
    const processor = (worker as any).processFn;

    const mockJob = {
      id: "job-101",
      attemptsMade: 0,
      data: {
        notificationId: "notif-success-1",
        batchId: "batch-success-1",
        channel: "EMAIL",
        recipient: "user@example.com",
        subject: "Subject",
        content: "Content",
        metadata: { key: "val" },
      },
    };

    vi.mocked(adapters.dispatchByChannel).mockResolvedValue({
      messageId: "mock-msg-123",
      delivered: true,
    } as any);

    const result = await processor(mockJob);

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "notif-success-1" },
      data: {
        status: "PROCESSING",
        auditLogs: {
          create: expect.objectContaining({
            fromStatus: "QUEUED",
            toStatus: "PROCESSING",
            event: "DISPATCH_STARTED",
          }),
        },
      },
    });

    expect(adapters.dispatchByChannel).toHaveBeenCalledWith(mockJob.data);

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "notif-success-1" },
      data: expect.objectContaining({
        status: "DELIVERED",
        auditLogs: {
          create: expect.objectContaining({
            fromStatus: "PROCESSING",
            toStatus: "DELIVERED",
            event: "DISPATCH_SUCCESS",
          }),
        },
      }),
    });

    expect(prisma.batchDispatch.update).toHaveBeenCalledWith({
      where: { id: "batch-success-1" },
      data: {
        processedItems: { increment: 1 },
        successfulItems: { increment: 1 },
      },
    });

    expect(result.success).toBe(true);

    await worker.close();
  });

  describe("Failure and Resilience Handling", () => {
    it("should schedule retry when attemptsMade < maxAttempts (temporary failure)", async () => {
      const worker = createNotificationWorker();

      // Retrieve registered 'failed' event handler
      const failureHandler = (worker as any).listeners("failed")[0];

      const mockJob = {
        opts: { attempts: 3 },
        attemptsMade: 1, // First attempt failed, 2 attempts remain
        data: {
          notificationId: "notif-retry-1",
          batchId: null,
        },
      };

      const error = new Error("Temporary network timeout");

      await failureHandler(mockJob, error);

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: "notif-retry-1" },
        data: {
          status: "QUEUED",
          retryCount: 1,
          lastError: "Temporary network timeout",
          auditLogs: {
            create: {
              fromStatus: "PROCESSING",
              toStatus: "QUEUED",
              event: "RETRY_SCHEDULED",
              details: {
                attempt: 1,
                maxAttempts: 3,
                error: "Temporary network timeout",
              },
            },
          },
        },
      });

      expect(queueLib.sendToDeadLetterQueue).not.toHaveBeenCalled();

      await worker.close();
    });

    it("should route to Dead Letter Queue (DLQ) when attempts are exhausted", async () => {
      const worker = createNotificationWorker();

      const failureHandler = (worker as any).listeners("failed")[0];

      const mockJob = {
        opts: { attempts: 3 },
        attemptsMade: 3, // All 3 attempts exhausted!
        data: {
          notificationId: "notif-exhausted-1",
          batchId: "batch-1",
        },
      };

      const fatalError = new Error("550 Mailbox not found");

      await failureHandler(mockJob, fatalError);

      expect(queueLib.sendToDeadLetterQueue).toHaveBeenCalledWith(mockJob, fatalError);

      await worker.close();
    });
  });
});
