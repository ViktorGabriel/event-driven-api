import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "./notification.service.js";
import { prisma } from "../lib/prisma.js";
import * as queueLib from "../lib/queue.js";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    batchDispatch: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/queue.js", () => ({
  enqueueNotification: vi.fn(),
  enqueueNotificationBulk: vi.fn(),
}));

describe("NotificationService Unit Tests", () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationService();
  });

  describe("dispatchSingle", () => {
    it("should persist notification in database and enqueue job in Redis", async () => {
      const mockNotification = {
        id: "notif-uuid-123",
        channel: "EMAIL",
        recipient: "test@enterprise.com",
        subject: "Hello",
        content: "Notification body",
        metadata: null,
        priority: "HIGH",
        status: "QUEUED",
        scheduledAt: null,
      };

      vi.mocked(prisma.notification.create).mockResolvedValue(mockNotification as any);
      vi.mocked(queueLib.enqueueNotification).mockResolvedValue({ id: "job-123" } as any);

      const result = await service.dispatchSingle({
        channel: "EMAIL",
        recipient: "test@enterprise.com",
        subject: "Hello",
        content: "Notification body",
        priority: "HIGH",
      });

      expect(prisma.notification.create).toHaveBeenCalledOnce();
      expect(queueLib.enqueueNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationId: "notif-uuid-123",
          channel: "EMAIL",
          recipient: "test@enterprise.com",
        }),
        "HIGH",
        undefined,
      );
      expect(result.jobId).toBe("job-123");
      expect(result.notification.id).toBe("notif-uuid-123");
    });
  });

  describe("dispatchBulk", () => {
    it("should create batch record and enqueue all notifications via BullMQ bulk", async () => {
      const mockBatch = { id: "batch-uuid-456", totalItems: 2, status: "PROCESSING" };
      const mockNotifications = [
        {
          id: "n-1",
          channel: "EMAIL",
          recipient: "a@a.com",
          content: "A",
          priority: "NORMAL",
        },
        {
          id: "n-2",
          channel: "SMS",
          recipient: "+5511999",
          content: "B",
          priority: "NORMAL",
        },
      ];

      vi.mocked(prisma.$transaction).mockResolvedValue({
        batch: mockBatch,
        notifications: mockNotifications,
      } as any);

      vi.mocked(queueLib.enqueueNotificationBulk).mockResolvedValue([] as any);

      const result = await service.dispatchBulk({
        notifications: [
          { channel: "EMAIL", recipient: "a@a.com", content: "A", priority: "NORMAL" },
          { channel: "SMS", recipient: "+5511999", content: "B", priority: "NORMAL" },
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(queueLib.enqueueNotificationBulk).toHaveBeenCalledOnce();
      expect(result.batchId).toBe("batch-uuid-456");
      expect(result.totalDispatched).toBe(2);
      expect(result.status).toBe("PROCESSING");
    });
  });

  describe("getNotificationById", () => {
    it("should retrieve a notification with audit logs", async () => {
      const mockNotification = {
        id: "notif-uuid-123",
        channel: "EMAIL",
        recipient: "test@domain.com",
        content: "Test",
        status: "DELIVERED",
        auditLogs: [
          { id: "log-1", event: "NOTIFICATION_CREATED" },
          { id: "log-2", event: "DISPATCH_SUCCESS" },
        ],
      };

      vi.mocked(prisma.notification.findUnique).mockResolvedValue(
        mockNotification as any,
      );

      const result = await service.getNotificationById("notif-uuid-123");
      expect(prisma.notification.findUnique).toHaveBeenCalledWith({
        where: { id: "notif-uuid-123" },
        include: {
          auditLogs: { orderBy: { createdAt: "desc" } },
          batch: true,
        },
      });
      expect(result?.id).toBe("notif-uuid-123");
      expect(result?.auditLogs).toHaveLength(2);
    });
  });

  describe("getNotifications", () => {
    it("should return items and correctly computed pagination", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([
        { id: "1" } as any,
        { id: "2" } as any,
      ]);
      vi.mocked(prisma.notification.count).mockResolvedValue(25);

      const result = await service.getNotifications({
        limit: 10,
        page: 2,
        status: "DELIVERED",
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { status: "DELIVERED" },
        take: 10,
        skip: 10,
        orderBy: { createdAt: "desc" },
      });
      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.page).toBe(2);
    });
  });
});
