import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendToDeadLetterQueue,
  replayDlqJob,
  notificationDlq,
  notificationQueue,
} from "./queue.js";
import { prisma } from "./prisma.js";

vi.mock("./prisma.js", () => ({
  prisma: {
    notification: {
      update: vi.fn(),
    },
    batchDispatch: {
      update: vi.fn(),
    },
  },
}));

vi.mock("./redis.js", () => ({
  redisConnection: {
    on: vi.fn(),
  },
}));

describe("Queue & Dead Letter Queue (DLQ) Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendToDeadLetterQueue", () => {
    it("should enqueue failed job into DLQ and update notification status to FAILED", async () => {
      const mockJob = {
        id: "job-origin-99",
        attemptsMade: 3,
        data: {
          notificationId: "notif-uuid-dlq",
          batchId: "batch-uuid-dlq",
          channel: "EMAIL",
          recipient: "permanent-error@fail.com",
          content: "Content",
        },
      };

      const mockError = new Error("Permanent SMTP bounce: 550 Mailbox not found");

      vi.spyOn(notificationDlq, "add").mockResolvedValue({
        id: "dlq-job-123",
      } as any);

      const dlqJob = await sendToDeadLetterQueue(mockJob as any, mockError);

      expect(notificationDlq.add).toHaveBeenCalledWith(
        "dead-letter-event",
        expect.objectContaining({
          notificationId: "notif-uuid-dlq",
          originalJobId: "job-origin-99",
          attemptsMade: 3,
          lastError: "Permanent SMTP bounce: 550 Mailbox not found",
        }),
        expect.any(Object),
      );

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: "notif-uuid-dlq" },
        data: {
          status: "FAILED",
          retryCount: 3,
          lastError: "Permanent SMTP bounce: 550 Mailbox not found",
          auditLogs: {
            create: {
              fromStatus: "PROCESSING",
              toStatus: "FAILED",
              event: "MOVED_TO_DLQ",
              details: {
                dlqJobId: "dlq-job-123",
                attemptsMade: 3,
                error: "Permanent SMTP bounce: 550 Mailbox not found",
              },
            },
          },
        },
      });

      expect(prisma.batchDispatch.update).toHaveBeenCalledWith({
        where: { id: "batch-uuid-dlq" },
        data: {
          processedItems: { increment: 1 },
          failedItems: { increment: 1 },
        },
      });

      expect(dlqJob.id).toBe("dlq-job-123");
    });
  });

  describe("replayDlqJob", () => {
    it("should retrieve job from DLQ, re-enqueue into main queue, and remove from DLQ", async () => {
      const mockRemove = vi.fn().mockResolvedValue(undefined);
      const mockDlqJob = {
        id: "dlq-job-777",
        data: {
          notificationId: "notif-replayed-1",
          batchId: null,
          channel: "SMS",
          recipient: "+5511999999999",
          content: "Retry message",
          originalJobId: "old-job-1",
          failedAt: "2026-11-06T12:00:00Z",
          attemptsMade: 3,
          lastError: "Some error",
        },
        remove: mockRemove,
      };

      vi.spyOn(notificationDlq, "getJob").mockResolvedValue(mockDlqJob as any);
      vi.spyOn(notificationQueue, "add").mockResolvedValue({
        id: "replayed-job-001",
      } as any);

      const result = await replayDlqJob("dlq-job-777");

      expect(notificationDlq.getJob).toHaveBeenCalledWith("dlq-job-777");
      expect(notificationQueue.add).toHaveBeenCalledWith(
        "dispatch-event",
        expect.objectContaining({
          notificationId: "notif-replayed-1",
          channel: "SMS",
        }),
        { priority: 2 },
      );
      expect(mockRemove).toHaveBeenCalledOnce();
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: "notif-replayed-1" },
        data: {
          status: "QUEUED",
          auditLogs: {
            create: {
              fromStatus: "FAILED",
              toStatus: "QUEUED",
              event: "REPLAYED_FROM_DLQ",
              details: { oldDlqJobId: "dlq-job-777", newJobId: "replayed-job-001" },
            },
          },
        },
      });
      expect(result.id).toBe("replayed-job-001");
    });

    it("should throw error if DLQ job is not found", async () => {
      vi.spyOn(notificationDlq, "getJob").mockResolvedValue(null);

      await expect(replayDlqJob("non-existent")).rejects.toThrow(
        "DLQ Job with ID 'non-existent' not found",
      );
    });
  });
});
