import { prisma } from "../lib/prisma.js";
import {
  enqueueNotification,
  enqueueNotificationBulk,
  NotificationJobData,
} from "../lib/queue.js";
import {
  CreateNotificationInput,
  BulkDispatchInput,
  NotificationFilterQuery,
} from "../schemas/notification.schema.js";

export class NotificationService {
  async dispatchSingle(input: CreateNotificationInput) {
    const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const delay = scheduledDate
      ? Math.max(0, scheduledDate.getTime() - Date.now())
      : undefined;

    // Persist in Database
    const notification = await prisma.notification.create({
      data: {
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        content: input.content,
        metadata: input.metadata ?? undefined,
        priority: input.priority,
        status: "QUEUED",
        scheduledAt: scheduledDate,
        auditLogs: {
          create: {
            fromStatus: "PENDING",
            toStatus: "QUEUED",
            event: "NOTIFICATION_CREATED",
            details: { priority: input.priority, scheduledAt: scheduledDate },
          },
        },
      },
    });

    // Enqueue in BullMQ Redis
    const jobData: NotificationJobData = {
      notificationId: notification.id,
      channel: notification.channel,
      recipient: notification.recipient,
      subject: notification.subject,
      content: notification.content,
      metadata: notification.metadata as Record<string, unknown> | null,
    };

    const job = await enqueueNotification(jobData, input.priority, delay);

    return {
      notification,
      jobId: job.id,
    };
  }

  async dispatchBulk(input: BulkDispatchInput) {
    const total = input.notifications.length;

    // Transaction: Create batch and notifications
    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.batchDispatch.create({
        data: {
          totalItems: total,
          status: "PROCESSING",
        },
      });

      const notificationsData = input.notifications.map((item) => ({
        batchId: createdBatch.id,
        channel: item.channel,
        recipient: item.recipient,
        subject: item.subject,
        content: item.content,
        metadata: item.metadata ?? undefined,
        priority: item.priority ?? "NORMAL",
        status: "QUEUED" as const,
        scheduledAt: item.scheduledAt ? new Date(item.scheduledAt) : null,
      }));

      // createMany or sequential create to get IDs
      const createdNotifications = await Promise.all(
        notificationsData.map(async (n) => {
          return tx.notification.create({
            data: {
              ...n,
              auditLogs: {
                create: {
                  fromStatus: "PENDING",
                  toStatus: "QUEUED",
                  event: "BATCH_NOTIFICATION_CREATED",
                  details: { batchId: createdBatch.id },
                },
              },
            },
          });
        }),
      );

      return {
        batch: createdBatch,
        notifications: createdNotifications,
      };
    });

    // Enqueue all in BullMQ
    const queueItems = batch.notifications.map((n) => {
      const delay = n.scheduledAt
        ? Math.max(0, n.scheduledAt.getTime() - Date.now())
        : undefined;

      return {
        data: {
          notificationId: n.id,
          batchId: batch.batch.id,
          channel: n.channel,
          recipient: n.recipient,
          subject: n.subject,
          content: n.content,
          metadata: n.metadata as Record<string, unknown> | null,
        },
        priority: n.priority,
        delay,
      };
    });

    await enqueueNotificationBulk(queueItems);

    return {
      batchId: batch.batch.id,
      totalDispatched: total,
      status: "PROCESSING",
    };
  }

  async getNotificationById(id: string) {
    return prisma.notification.findUnique({
      where: { id },
      include: {
        auditLogs: {
          orderBy: { createdAt: "desc" },
        },
        batch: true,
      },
    });
  }

  async getNotifications(filters: NotificationFilterQuery) {
    const { channel, status, recipient, batchId, limit = 20, page = 1 } = filters;
    const skip = (page - 1) * limit;

    const where = {
      ...(channel && { channel }),
      ...(status && { status }),
      ...(recipient && {
        recipient: { contains: recipient, mode: "insensitive" as const },
      }),
      ...(batchId && { batchId }),
    };

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBatchById(batchId: string) {
    return prisma.batchDispatch.findUnique({
      where: { id: batchId },
      include: {
        _count: {
          select: { notifications: true },
        },
      },
    });
  }
}
